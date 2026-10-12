import { describe, expect, it } from 'vitest'
import { decryptApiKey, encryptApiKey } from './crypto.js'

describe('crypto', () => {
  it('roundtrips a key', () => {
    const plaintext = 'secret-api-key-12345'
    expect(decryptApiKey(encryptApiKey(plaintext))).toBe(plaintext)
  })

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const plaintext = 'same-key'
    expect(encryptApiKey(plaintext)).not.toBe(encryptApiKey(plaintext))
  })

  it('rejects tampered ciphertext', () => {
    const encoded = encryptApiKey('secret')
    const raw = Buffer.from(encoded, 'base64')
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff
    expect(() => decryptApiKey(raw.toString('base64'))).toThrow()
  })

  it('handles unicode', () => {
    const plaintext = 'cheie-secretă-ăîșț-🔑'
    expect(decryptApiKey(encryptApiKey(plaintext))).toBe(plaintext)
  })
})
