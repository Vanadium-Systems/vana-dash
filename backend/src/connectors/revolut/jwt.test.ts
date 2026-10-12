import { createVerify, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { config } from '../../shared/config.js'
import { signClientAssertion } from './jwt.js'

function decodeBase64url(segment: string): Buffer {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(segment.length + ((4 - (segment.length % 4)) % 4), '=')
  return Buffer.from(padded, 'base64')
}

function generateTestKeyPair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
}

describe('signClientAssertion', () => {
  it('produces a 3-part JWT with the expected header, payload and a verifiable signature', () => {
    const { privateKey, publicKey } = generateTestKeyPair()
    const clientId = 'client-id-123'

    const jwt = signClientAssertion(clientId, privateKey)
    const parts = jwt.split('.')
    expect(parts).toHaveLength(3)

    const header = JSON.parse(decodeBase64url(parts[0]!).toString('utf8'))
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' })

    const payload = JSON.parse(decodeBase64url(parts[1]!).toString('utf8'))
    expect(payload.sub).toBe(clientId)
    expect(payload.aud).toBe('https://revolut.com')
    // Domeniul FĂRĂ schemă — confirmat empiric contra Revolut sandbox (eroarea
    // 401/9001 la 'https://' inclus), nu doar din research indirect.
    expect(payload.iss).toBe(new URL(config.revolutRedirectUri).hostname)
    expect(payload.iss).not.toMatch(/^https?:\/\//)

    const nowSeconds = Math.floor(Date.now() / 1000)
    expect(payload.exp).toBeGreaterThan(nowSeconds + 3595) // ~1h minus small margin
    expect(payload.exp).toBeLessThanOrEqual(nowSeconds + 3600)
    expect(payload.iat).toBeLessThanOrEqual(nowSeconds)

    const signingInput = `${parts[0]}.${parts[1]}`
    const signature = decodeBase64url(parts[2]!)
    const verified = createVerify('RSA-SHA256').update(signingInput).verify(publicKey, signature)
    expect(verified).toBe(true)
  })

  it('fails verification against a different (wrong) public key', () => {
    const { privateKey } = generateTestKeyPair()
    const { publicKey: unrelatedPublicKey } = generateTestKeyPair()

    const jwt = signClientAssertion('client-id-123', privateKey)
    const [headerPart, payloadPart, sigPart] = jwt.split('.')
    const signingInput = `${headerPart}.${payloadPart}`
    const signature = decodeBase64url(sigPart!)
    const verified = createVerify('RSA-SHA256').update(signingInput).verify(unrelatedPublicKey, signature)
    expect(verified).toBe(false)
  })

  it('generates a fresh JWT on every call (iat/signature differ)', async () => {
    const { privateKey } = generateTestKeyPair()
    const first = signClientAssertion('client-id-123', privateKey)
    await new Promise((resolve) => setTimeout(resolve, 1100)) // iat has second resolution
    const second = signClientAssertion('client-id-123', privateKey)
    expect(first).not.toBe(second)
  })
})
