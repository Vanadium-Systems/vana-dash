import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { webcrypto } from "node:crypto";
import assert from "node:assert/strict";
import {
  Account,
  GroupSession,
  GroupSessionVersion,
  InboundGroupSession,
  OlmMessage,
  SessionConfigVersion,
  initAsync,
} from "@towns-protocol/vodozemac";

const subtle = webcrypto.subtle;

async function encryptBackup(plaintextJson, recoveryKeyBytes) {
  const key = await subtle.importKey("raw", recoveryKeyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintextJson)
  );
  return { iv: Buffer.from(iv).toString("base64"), ct: Buffer.from(ct).toString("base64") };
}

async function decryptBackup(payload, recoveryKeyBytes) {
  const key = await subtle.importKey("raw", recoveryKeyBytes, "AES-GCM", false, ["decrypt"]);
  const iv = Buffer.from(payload.iv, "base64");
  const ct = Buffer.from(payload.ct, "base64");
  const pt = await subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

function establishOlmPair(senderAcc, receiverAcc) {
  receiverAcc.generate_one_time_keys(1);
  const rawOtks = receiverAcc.one_time_keys;
  const otks = rawOtks instanceof Map ? [...rawOtks.values()] : Object.values(rawOtks);
  assert.equal(otks.length, 1);
  const otk = otks[0];
  receiverAcc.mark_keys_as_published();

  const outbound = senderAcc.create_outbound_session(
    receiverAcc.curve25519_key,
    otk,
    SessionConfigVersion.V2
  );
  return {
    outbound,
    sendAndReceiveFirst: (msgText) => {
      const olmMsg = outbound.encrypt(msgText);
      const inboundRes = receiverAcc.create_inbound_session(
        senderAcc.curve25519_key,
        new OlmMessage(olmMsg.message_type, olmMsg.ciphertext)
      );
      return { inbound: inboundRes.session, plaintext: inboundRes.plaintext };
    },
  };
}

async function main() {
  await initAsync();

  // 1. Measure WASM size
  const wasmPath = new URL(
    "./node_modules/@towns-protocol/vodozemac/pkg/vodozemac_bg.wasm",
    import.meta.url
  );
  const wasmBytes = readFileSync(wasmPath);
  const wasmGzip = gzipSync(wasmBytes);
  console.log(
    `[vodozemac] WASM raw: ${(wasmBytes.length / 1024).toFixed(1)} KB, gzip: ${(wasmGzip.length / 1024).toFixed(1)} KB`
  );

  // 2. Create devices: Alice (2 devices), Bob (1), Charlie (1)
  const alice1 = new Account();
  const alice2 = new Account();
  const bob1 = new Account();
  const charlie1 = new Account();

  // 3. Establish 1:1 Olm sessions from alice1 to alice2, bob1, charlie1
  const olmA1toA2 = establishOlmPair(alice1, alice2);
  const olmA1toBob = establishOlmPair(alice1, bob1);
  const olmA1toCharlie = establishOlmPair(alice1, charlie1);

  // 4. Alice1 starts a Megolm GroupSession for the 3-person group
  const groupOut1 = new GroupSession(GroupSessionVersion.V2);
  const sessionKeyPayload = JSON.stringify({
    sessionId: groupOut1.session_id,
    sessionKey: groupOut1.session_key,
  });

  // Distribute sessionKey via Olm 1:1 channels
  const a2KeyMsg = olmA1toA2.sendAndReceiveFirst(sessionKeyPayload);
  const bobKeyMsg = olmA1toBob.sendAndReceiveFirst(sessionKeyPayload);
  const charlieKeyMsg = olmA1toCharlie.sendAndReceiveFirst(sessionKeyPayload);

  const a1Inbound = new InboundGroupSession(groupOut1.session_key, GroupSessionVersion.V2);
  const a2Inbound = new InboundGroupSession(JSON.parse(a2KeyMsg.plaintext).sessionKey, GroupSessionVersion.V2);
  const bobInbound = new InboundGroupSession(JSON.parse(bobKeyMsg.plaintext).sessionKey, GroupSessionVersion.V2);
  const charlieInbound = new InboundGroupSession(JSON.parse(charlieKeyMsg.plaintext).sessionKey, GroupSessionVersion.V2);

  // Encrypt & decrypt in group
  const ct1 = groupOut1.encrypt("Salut grup! Mesaj 1.");
  assert.equal(a1Inbound.decrypt(ct1).plaintext, "Salut grup! Mesaj 1.");
  assert.equal(a2Inbound.decrypt(ct1).plaintext, "Salut grup! Mesaj 1.");
  assert.equal(bobInbound.decrypt(ct1).plaintext, "Salut grup! Mesaj 1.");
  assert.equal(charlieInbound.decrypt(ct1).plaintext, "Salut grup! Mesaj 1.");
  console.log("[vodozemac] Group of 3 (4 devices) encrypted & decrypted OK.");

  // 5. Charlie leaves -> Alice1 rotates GroupSession (new session, sent only to Alice2 & Bob1)
  const groupOut2 = new GroupSession(GroupSessionVersion.V2);
  const rotatedPayload = JSON.stringify({
    sessionId: groupOut2.session_id,
    sessionKey: groupOut2.session_key,
  });

  const encForA2 = olmA1toA2.outbound.encrypt(rotatedPayload);
  const encForBob = olmA1toBob.outbound.encrypt(rotatedPayload);

  const a2RotatedKey = JSON.parse(a2KeyMsg.inbound.decrypt(encForA2)).sessionKey;
  const bobRotatedKey = JSON.parse(bobKeyMsg.inbound.decrypt(encForBob)).sessionKey;

  const a2Inbound2 = new InboundGroupSession(a2RotatedKey, GroupSessionVersion.V2);
  const bobInbound2 = new InboundGroupSession(bobRotatedKey, GroupSessionVersion.V2);

  const ct2 = groupOut2.encrypt("Mesaj secret după ce Charlie a ieșit.");
  assert.equal(a2Inbound2.decrypt(ct2).plaintext, "Mesaj secret după ce Charlie a ieșit.");
  assert.equal(bobInbound2.decrypt(ct2).plaintext, "Mesaj secret după ce Charlie a ieșit.");
  assert.throws(() => charlieInbound.decrypt(ct2));
  console.log("[vodozemac] Member removed & session rotated: Charlie cannot decrypt new message OK.");

  // 6. New device (alice3) joins using recovery key backup
  const recoveryKey = webcrypto.getRandomValues(new Uint8Array(32));
  const exportedSession = a1Inbound.export_at(0);
  assert.ok(exportedSession, "export_at(0) should return exported key");

  const encryptedBackup = await encryptBackup(JSON.stringify([exportedSession]), recoveryKey);
  const decryptedList = JSON.parse(await decryptBackup(encryptedBackup, recoveryKey));

  const alice3Inbound = InboundGroupSession.import(decryptedList[0], GroupSessionVersion.V2);
  assert.equal(alice3Inbound.decrypt(ct1).plaintext, "Salut grup! Mesaj 1.");
  console.log("[vodozemac] New device restored history via recovery key OK.");

  // Cleanup WASM objects
  [alice1, alice2, bob1, charlie1, groupOut1, groupOut2, a1Inbound, a2Inbound, bobInbound, charlieInbound, a2Inbound2, bobInbound2, alice3Inbound].forEach((x) =>
    x.free()
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
