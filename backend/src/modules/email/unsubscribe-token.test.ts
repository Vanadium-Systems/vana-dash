import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { config } from '../../shared/config.js'
import { buildUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token.js'

const ORIGINAL_SECRET = config.emailUnsubscribeSecret

beforeEach(() => {
  config.emailUnsubscribeSecret = 'test-secret-32-bytes-not-really-but-fine'
})

afterEach(() => {
  config.emailUnsubscribeSecret = ORIGINAL_SECRET
})

describe('buildUnsubscribeToken / verifyUnsubscribeToken', () => {
  it('round-trips a token back to the normalized (lowercase, trimmed) email', () => {
    const token = buildUnsubscribeToken('  Someone@Example.COM  ')
    expect(token).toBeTruthy()
    expect(verifyUnsubscribeToken(token!)).toBe('someone@example.com')
  })

  it('rejects a tampered signature', () => {
    const token = buildUnsubscribeToken('someone@example.com')!
    const [emailPart] = token.split('.')
    const tampered = `${emailPart}.not-a-real-signature`
    expect(verifyUnsubscribeToken(tampered)).toBeNull()
  })

  it('rejects a token for a different email than what the signature covers', () => {
    const tokenA = buildUnsubscribeToken('a@example.com')!
    const tokenB = buildUnsubscribeToken('b@example.com')!
    const [, signatureB] = tokenB.split('.')
    const [emailPartA] = tokenA.split('.')
    expect(verifyUnsubscribeToken(`${emailPartA}.${signatureB}`)).toBeNull()
  })

  it('rejects a malformed token (no separator)', () => {
    expect(verifyUnsubscribeToken('not-a-valid-token')).toBeNull()
  })

  it('rejects an empty token', () => {
    expect(verifyUnsubscribeToken('')).toBeNull()
  })

  it('returns null from buildUnsubscribeToken when the secret is not configured (fail-closed)', () => {
    config.emailUnsubscribeSecret = ''
    expect(buildUnsubscribeToken('someone@example.com')).toBeNull()
  })

  it('returns null from verifyUnsubscribeToken when the secret is not configured (fail-closed)', () => {
    const token = buildUnsubscribeToken('someone@example.com')!
    config.emailUnsubscribeSecret = ''
    expect(verifyUnsubscribeToken(token)).toBeNull()
  })

  it('two different emails produce two different tokens', () => {
    const tokenA = buildUnsubscribeToken('a@example.com')
    const tokenB = buildUnsubscribeToken('b@example.com')
    expect(tokenA).not.toBe(tokenB)
  })
})
