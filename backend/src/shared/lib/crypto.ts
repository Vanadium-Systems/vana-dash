import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'

// AES-256-GCM. Format stocat: base64(iv[12] | authTag[16] | ciphertext).
// MASTER_ENCRYPTION_KEY = 32 bytes hex (openssl rand -hex 32).

const IV_LENGTH = 12
const TAG_LENGTH = 16

function masterKey(): Buffer {
  const key = Buffer.from(config.masterEncryptionKey, 'hex')
  if (key.length !== 32) throw new Error('MASTER_ENCRYPTION_KEY must be 32 bytes hex (64 chars)')
  return key
}

export function encryptApiKey(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
}

export function decryptApiKey(encoded: string): string {
  const raw = Buffer.from(encoded, 'base64')
  const iv = raw.subarray(0, IV_LENGTH)
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH)
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/** Comparație constant-time (Track A) — pt. secrete comparate direct (ex. X-Ingest-Token),
 *  nu decriptate din DB. `timingSafeEqual` cere buffere de aceeași lungime — verificăm
 *  lungimea înainte, altfel ar arunca (nu doar întoarce false) pe input de lungime diferită. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
