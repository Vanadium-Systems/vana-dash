// WebCrypto pieces of the end-to-end layer (PLAN.md part M): the person's master signing key
// (Ed25519), the recovery key and what it derives (HKDF), and AES-256-GCM for the key backup and
// for files. Olm/Megolm themselves come from vodozemac; nothing here is hand-rolled cryptography,
// only the platform's primitives put together.

const subtle = globalThis.crypto.subtle

export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function fromBase64(text: string): Uint8Array {
  // vodozemac writes unpadded base64; the server's bytea round-trip adds the padding back.
  const clean = text.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')
  const binary = atob(clean + '='.repeat((4 - (clean.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function unpadded(base64: string): string {
  return base64.replace(/=+$/, '')
}

// A Megolm message does not name its session (Matrix sends the id next to it, in the event).
// Here it travels in the same opaque field: base64 of "<session id>|<Megolm ciphertext>".
export function packCiphertext(sessionId: string, ciphertext: string): string {
  return toBase64(new TextEncoder().encode(`${sessionId}|${ciphertext}`))
}

export function unpackCiphertext(packed: string): { sessionId: string; ciphertext: string } | null {
  try {
    const text = new TextDecoder().decode(fromBase64(packed))
    const separator = text.indexOf('|')
    if (separator <= 0) return null
    return { sessionId: text.slice(0, separator), ciphertext: text.slice(separator + 1) }
  } catch {
    return null
  }
}

export function randomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length))
}

// TS 5.8 types BufferSource as ArrayBuffer-backed views only; ours always are.
const buf = (bytes: Uint8Array) => bytes as Uint8Array<ArrayBuffer>

// ── Recovery key ─────────────────────────────────────────────────────────────
// 32 random bytes plus one checksum byte, in Crockford base32 (no I, L, O, U: nothing to misread),
// grouped by four. 53 characters; a typo is caught by the checksum before any network call.

const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export async function newRecoveryKey(): Promise<{ bytes: Uint8Array; text: string }> {
  const bytes = randomBytes(32)
  return { bytes, text: await formatRecoveryKey(bytes) }
}

async function formatRecoveryKey(bytes: Uint8Array): Promise<string> {
  const check = new Uint8Array(await subtle.digest('SHA-256', buf(bytes)))[0]!
  const all = new Uint8Array([...bytes, check])
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of all) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]
  return out.match(/.{1,4}/g)!.join(' ')
}

/** The 32 key bytes, or null when the text is not a recovery key (wrong length, typo). */
export async function parseRecoveryKey(text: string): Promise<Uint8Array | null> {
  const clean = text
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  if (clean.length !== 53) return null
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of clean) {
    const index = BASE32.indexOf(char)
    if (index < 0) return null
    value = ((value << 5) | index) & 0xffff
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  const bytes = new Uint8Array(out.slice(0, 32))
  const check = new Uint8Array(await subtle.digest('SHA-256', buf(bytes)))[0]
  return out[32] === check ? bytes : null
}

/** The backup key and the check the server keeps to tell a wrong recovery key apart. */
export async function deriveFromRecoveryKey(recovery: Uint8Array): Promise<{ backupKey: Uint8Array; check: string }> {
  const base = await subtle.importKey('raw', buf(recovery), 'HKDF', false, ['deriveBits'])
  const derive = async (info: string) =>
    new Uint8Array(
      await subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode(info) },
        base,
        256,
      ),
    )
  return { backupKey: await derive('vana-dash backup key v1'), check: toBase64(await derive('vana-dash recovery check v1')) }
}

// ── AES-256-GCM ─────────────────────────────────────────────────────────────

async function aesKey(raw: Uint8Array, usage: KeyUsage[]): Promise<CryptoKey> {
  return subtle.importKey('raw', buf(raw), 'AES-GCM', false, usage)
}

/** iv (12 bytes) followed by the ciphertext, in base64. `context` is bound as associated data. */
export async function seal(key: Uint8Array, plaintext: string, context: string): Promise<string> {
  const iv = randomBytes(12)
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv: buf(iv), additionalData: new TextEncoder().encode(context) },
    await aesKey(key, ['encrypt']),
    new TextEncoder().encode(plaintext),
  )
  return toBase64(new Uint8Array([...iv, ...new Uint8Array(ciphertext)]))
}

export async function open(key: Uint8Array, sealed: string, context: string): Promise<string> {
  const bytes = fromBase64(sealed)
  const plaintext = await subtle.decrypt(
    { name: 'AES-GCM', iv: buf(bytes.subarray(0, 12)), additionalData: new TextEncoder().encode(context) },
    await aesKey(key, ['decrypt']),
    buf(bytes.subarray(12)),
  )
  return new TextDecoder().decode(plaintext)
}

/** A file encrypted with its own key; the key, iv and hash travel inside the message. */
export async function encryptBytes(data: ArrayBuffer): Promise<{ data: Uint8Array; key: string; iv: string; sha256: string }> {
  const key = randomBytes(32)
  const iv = randomBytes(12)
  const ciphertext = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, await aesKey(key, ['encrypt']), data))
  const hash = new Uint8Array(await subtle.digest('SHA-256', ciphertext))
  return { data: ciphertext, key: toBase64(key), iv: toBase64(iv), sha256: toBase64(hash) }
}

export async function decryptBytes(data: ArrayBuffer, meta: { key: string; iv: string; sha256?: string }): Promise<ArrayBuffer> {
  if (meta.sha256) {
    const hash = toBase64(new Uint8Array(await subtle.digest('SHA-256', data)))
    if (unpadded(hash) !== unpadded(meta.sha256)) throw new Error('attachment hash mismatch')
  }
  return subtle.decrypt({ name: 'AES-GCM', iv: buf(fromBase64(meta.iv)) }, await aesKey(fromBase64(meta.key), ['decrypt']), data)
}

// ── Master key (Ed25519) ─────────────────────────────────────────────────────

export async function newMasterKey(): Promise<{ publicKey: string; privatePkcs8: string }> {
  const pair = (await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
  return {
    publicKey: toBase64(new Uint8Array(await subtle.exportKey('raw', pair.publicKey))),
    privatePkcs8: toBase64(new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey))),
  }
}

/** The public half of a private master key, to check a received secret matches the published key. */
export async function masterPublicOf(privatePkcs8: string): Promise<string> {
  const key = await subtle.importKey('pkcs8', buf(fromBase64(privatePkcs8)), { name: 'Ed25519' }, true, ['sign'])
  const jwk = await subtle.exportKey('jwk', key)
  return toBase64(fromBase64(jwk.x!))
}

export async function signWithMaster(privatePkcs8: string, payload: string): Promise<string> {
  const key = await subtle.importKey('pkcs8', buf(fromBase64(privatePkcs8)), { name: 'Ed25519' }, false, ['sign'])
  return toBase64(new Uint8Array(await subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(payload))))
}

export async function verifyMaster(publicKey: string, payload: string, signature: string): Promise<boolean> {
  try {
    const key = await subtle.importKey('raw', buf(fromBase64(publicKey)), { name: 'Ed25519' }, false, ['verify'])
    return await subtle.verify({ name: 'Ed25519' }, key, buf(fromBase64(signature)), new TextEncoder().encode(payload))
  } catch {
    return false
  }
}

/** Same string as deviceSignaturePayload in backend/src/modules/chat/keys.ts. */
export function deviceSignaturePayload(device: { id: string; publicIdentityKey: string; signingKey: string }): string {
  return `vana-dash-device:v1:${device.id}:${device.publicIdentityKey}:${device.signingKey}`
}

/** Six digits both screens show when one device approves another. */
export async function approvalCode(device: { publicIdentityKey: string; signingKey: string }): Promise<string> {
  const digest = new Uint8Array(
    await subtle.digest('SHA-256', new TextEncoder().encode(`vana-dash-approve:v1:${device.publicIdentityKey}:${device.signingKey}`)),
  )
  const number = ((digest[0]! << 16) | (digest[1]! << 8) | digest[2]!) % 1_000_000
  return number.toString().padStart(6, '0').replace(/(\d{3})(\d{3})/, '$1 $2')
}

export function isSupported(): boolean {
  return typeof indexedDB !== 'undefined' && typeof WebAssembly !== 'undefined' && Boolean(globalThis.crypto?.subtle)
}

/** Ed25519 in WebCrypto is recent (Chrome 137, Safari 17, Firefox 129). */
export async function hasEd25519(): Promise<boolean> {
  try {
    await subtle.generateKey({ name: 'Ed25519' }, false, ['sign'])
    return true
  } catch {
    return false
  }
}
