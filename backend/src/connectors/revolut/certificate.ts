import { generate } from 'selfsigned'

// Certificatul folosit de Revolut Business API pentru a verifica JWT-urile de
// client assertion. E generat local (RSA, self-signed) — Stefan urcă manual
// DOAR partea publică (certificatePem) în Revolut Business Settings → API.
// Cheia privată (privateKeyPem) nu părăsește niciodată acest server: e criptată
// AES-256-GCM și stocată în bank_accounts.private_key_enc.
//
// Validitate lungă (10 ani) — e un pas manual de reînnoit, nu vrem să cerem
// asta des. Common name generic, nu identifică nimic sensibil.

const COMMON_NAME = 'vana-dash.vanadium.systems'
const KEY_SIZE_BITS = 2048
const VALIDITY_YEARS = 10

export interface SelfSignedCertificate {
  certificatePem: string
  privateKeyPem: string
}

export async function generateSelfSignedCertificate(): Promise<SelfSignedCertificate> {
  const notBeforeDate = new Date()
  const notAfterDate = new Date(notBeforeDate)
  notAfterDate.setFullYear(notAfterDate.getFullYear() + VALIDITY_YEARS)

  const pems = await generate([{ name: 'commonName', value: COMMON_NAME }], {
    keySize: KEY_SIZE_BITS,
    algorithm: 'sha256',
    notBeforeDate,
    notAfterDate,
  })

  return { certificatePem: pems.cert, privateKeyPem: pems.private }
}
