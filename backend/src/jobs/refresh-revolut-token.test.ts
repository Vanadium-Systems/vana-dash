/**
 * Integration test — pg real (test/setup.ts). Verifică izolarea eșecului per cont
 * (CLAUDE.md regula 7): un cont Revolut broken NU trebuie să blocheze refresh-ul
 * celorlalte conturi din același job run.
 */
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { refreshTokens } from '../connectors/revolut/oauth.js'
import { db } from '../shared/db/client.js'
import { bankAccounts } from '../shared/db/schema/index.js'
import { decryptApiKey, encryptApiKey } from '../shared/lib/crypto.js'
import { refreshRevolutTokensIfNeeded } from './refresh-revolut-token.js'

vi.mock('../connectors/revolut/oauth.js', () => ({
  refreshTokens: vi.fn(),
}))

const NOW = Date.now()
const ALMOST_EXPIRED = new Date(NOW + 5 * 60 * 1000) // 5 min left < 15 min refresh threshold

let brokenAccountId = ''
let healthyAccountId = ''

beforeAll(async () => {
  const [broken] = await db
    .insert(bankAccounts)
    .values({
      provider: 'revolut',
      name: 'QA Broken Revolut Account',
      currency: 'RON',
      authStatus: 'active',
      clientId: 'client-broken',
      privateKeyEnc: encryptApiKey('fake-private-key-broken'),
      refreshTokenEnc: encryptApiKey('refresh-token-broken'),
      tokenExpiresAt: ALMOST_EXPIRED,
    })
    .returning({ id: bankAccounts.id })
  brokenAccountId = broken!.id

  const [healthy] = await db
    .insert(bankAccounts)
    .values({
      provider: 'revolut',
      name: 'QA Healthy Revolut Account',
      currency: 'RON',
      authStatus: 'active',
      clientId: 'client-healthy',
      privateKeyEnc: encryptApiKey('fake-private-key-healthy'),
      refreshTokenEnc: encryptApiKey('refresh-token-healthy'),
      tokenExpiresAt: ALMOST_EXPIRED,
    })
    .returning({ id: bankAccounts.id })
  healthyAccountId = healthy!.id
})

afterAll(async () => {
  await db.delete(bankAccounts).where(eq(bankAccounts.id, brokenAccountId))
  await db.delete(bankAccounts).where(eq(bankAccounts.id, healthyAccountId))
})

afterEach(() => {
  vi.mocked(refreshTokens).mockReset()
})

describe('refreshRevolutTokensIfNeeded — per-account failure isolation', () => {
  it('marks the broken account needs_reauth and still refreshes the healthy one', async () => {
    vi.mocked(refreshTokens).mockImplementation(async (_refreshToken, clientId) => {
      if (clientId === 'client-broken') {
        throw new Error('Revolut /auth/token returned 401: invalid_grant')
      }
      return {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresAt: new Date(Date.now() + 40 * 60 * 1000),
      }
    })

    await refreshRevolutTokensIfNeeded()

    const [brokenRow] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, brokenAccountId))
    expect(brokenRow?.authStatus).toBe('needs_reauth')

    const [healthyRow] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, healthyAccountId))
    expect(healthyRow?.authStatus).toBe('active')
    expect(healthyRow?.accessTokenEnc).toBeTruthy()
    expect(decryptApiKey(healthyRow!.accessTokenEnc!)).toBe('new-access-token')
    expect(healthyRow?.tokenExpiresAt?.getTime()).toBeGreaterThan(Date.now() + 30 * 60 * 1000)

    // refreshTokens a fost apelat pentru AMBELE conturi — eșecul primului nu a
    // oprit iterația înainte de a ajunge la al doilea.
    expect(vi.mocked(refreshTokens)).toHaveBeenCalledTimes(2)
  })

  it('does not touch accounts that are not near expiry', async () => {
    const [farFuture] = await db
      .insert(bankAccounts)
      .values({
        provider: 'revolut',
        name: 'QA Not-Yet-Expiring Account',
        currency: 'RON',
        authStatus: 'active',
        clientId: 'client-not-expiring',
        privateKeyEnc: encryptApiKey('fake-private-key'),
        refreshTokenEnc: encryptApiKey('refresh-token'),
        tokenExpiresAt: new Date(Date.now() + 39 * 60 * 1000), // well above 15 min threshold
      })
      .returning({ id: bankAccounts.id })

    vi.mocked(refreshTokens).mockResolvedValue({
      accessToken: 'unexpected-refresh',
      refreshToken: 'unexpected-refresh-rt',
      expiresAt: new Date(),
    })

    try {
      await refreshRevolutTokensIfNeeded()
      const calledClientIds = vi.mocked(refreshTokens).mock.calls.map((c) => c[1])
      expect(calledClientIds).not.toContain('client-not-expiring')
    } finally {
      await db.delete(bankAccounts).where(eq(bankAccounts.id, farFuture!.id))
    }
  })
})
