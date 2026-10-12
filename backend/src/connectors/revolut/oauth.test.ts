import { afterEach, describe, expect, it, vi } from 'vitest'
import { config } from '../../shared/config.js'
import { buildAuthorizeUrl, exchangeCode, refreshTokens } from './oauth.js'

// jwt.ts semnează cu node:crypto folosind privateKeyPem — pentru testele de oauth
// nu ne interesează validitatea criptografică a JWT-ului, doar body-ul trimis la
// Revolut și parsarea răspunsului, deci mockăm signClientAssertion direct.
vi.mock('./jwt.js', () => ({
  signClientAssertion: vi.fn(() => 'mocked.jwt.assertion'),
}))

const FAKE_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('buildAuthorizeUrl', () => {
  it('builds the expected authorize URL with all params', () => {
    const url = buildAuthorizeUrl('client-abc', 'account-state-123')
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://business.revolut.com/app-confirm')
    expect(parsed.searchParams.get('client_id')).toBe('client-abc')
    expect(parsed.searchParams.get('redirect_uri')).toBe(config.revolutRedirectUri)
    expect(parsed.searchParams.get('response_type')).toBe('code')
    expect(parsed.searchParams.get('scope')).toBe('READ')
    expect(parsed.searchParams.get('state')).toBe('account-state-123')
  })
})

describe('exchangeCode', () => {
  it('POSTs the correct body and parses the token response', async () => {
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.method).toBe('POST')
      expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded')
      const body = new URLSearchParams(init.body as string)
      expect(body.get('grant_type')).toBe('authorization_code')
      expect(body.get('code')).toBe('auth-code-xyz')
      expect(body.get('client_id')).toBe('client-abc')
      expect(body.get('client_assertion_type')).toBe('urn:ietf:params:oauth:client-assertion-type:jwt-bearer')
      expect(body.get('client_assertion')).toBe('mocked.jwt.assertion')
      return new Response(
        JSON.stringify({ access_token: 'at-1', refresh_token: 'rt-1', token_type: 'bearer', expires_in: 2400 }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchSpy)

    const before = Date.now()
    const tokens = await exchangeCode('auth-code-xyz', 'client-abc', FAKE_PRIVATE_KEY)
    expect(tokens.accessToken).toBe('at-1')
    expect(tokens.refreshToken).toBe('rt-1')
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(before + 2400 * 1000 - 1000)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const calledUrl = fetchSpy.mock.calls[0]![0] as string
    expect(calledUrl).toBe(`${config.revolutApiUrl}/auth/token`)
  })

  it('throws a descriptive error on non-200 without leaking the token/JWT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('invalid_grant: code expired', { status: 400 })),
    )
    await expect(exchangeCode('bad-code', 'client-abc', FAKE_PRIVATE_KEY)).rejects.toThrow(/400/)
    try {
      await exchangeCode('bad-code', 'client-abc', FAKE_PRIVATE_KEY)
    } catch (err) {
      expect(String(err)).not.toContain('mocked.jwt.assertion')
    }
  })

  it('throws when the response is 200 but missing tokens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ token_type: 'bearer' }), { status: 200 })),
    )
    await expect(exchangeCode('code', 'client-abc', FAKE_PRIVATE_KEY)).rejects.toThrow(/access_token/)
  })
})

describe('refreshTokens', () => {
  it('POSTs grant_type=refresh_token with the refresh token', async () => {
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      const body = new URLSearchParams(init.body as string)
      expect(body.get('grant_type')).toBe('refresh_token')
      expect(body.get('refresh_token')).toBe('rt-old')
      expect(body.get('client_assertion')).toBe('mocked.jwt.assertion')
      return new Response(
        JSON.stringify({ access_token: 'at-2', refresh_token: 'rt-2', token_type: 'bearer', expires_in: 2400 }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchSpy)

    const tokens = await refreshTokens('rt-old', 'client-abc', FAKE_PRIVATE_KEY)
    expect(tokens.accessToken).toBe('at-2')
    expect(tokens.refreshToken).toBe('rt-2')
  })

  it('propagates HTTP errors (e.g. revoked refresh token) as a throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('invalid refresh token', { status: 401 })),
    )
    await expect(refreshTokens('revoked-rt', 'client-abc', FAKE_PRIVATE_KEY)).rejects.toThrow(/401/)
  })
})
