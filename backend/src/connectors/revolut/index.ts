import { config } from '../../shared/config.js'
// shared/lib/revolut.ts e scris de agentul backend (orchestrare DB: decrypt/encrypt,
// refresh, markNeedsReauth). Acest connector rămâne stateless — nu atinge DB direct,
// doar importă sesiunea gata de folosit.
import { getRevolutSession } from '../../shared/lib/revolut.js'
import type { BankAccountConfig, BankConnector, BankTransaction, PlatformHealth } from '../types.js'
import { transformTransactions } from './transform.js'
import type { RevolutTransaction } from './types.js'

// Connector Revolut Business API. account.accessToken = access token OAuth2
// (Bearer), decriptat și reîmprospătat (dacă e nevoie) de prepareSession()
// înainte de orice fetch — vezi shared/lib/revolut.ts pentru orchestrarea
// refresh-ului (JWT client assertion, expirare 40 min).

const FETCH_TIMEOUT_MS = 30_000
const PAGE_SIZE = 1000

async function revolutGet<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${config.revolutApiUrl}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (res.status === 401 || res.status === 403) {
    throw new Error(`Revolut: token invalid/expirat (HTTP ${res.status})`)
  }
  if (!res.ok) throw new Error(`Revolut: ${path.split('?')[0]} returned HTTP ${res.status}`)
  return (await res.json()) as T
}

export const revolutConnector: BankConnector = {
  type: 'revolut',
  displayName: 'Revolut Business',

  async prepareSession(accountId: string): Promise<{ accessToken: string }> {
    return getRevolutSession(accountId)
  },

  async fetchTransactions(account: BankAccountConfig, from: Date, to: Date): Promise<BankTransaction[]> {
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      count: String(PAGE_SIZE),
    })
    if (account.accountRef) params.set('account', account.accountRef)

    const transactions = await revolutGet<RevolutTransaction[]>(account.accessToken, `/transactions?${params}`)
    return transformTransactions(transactions, account.accountRef)
  },

  async checkHealth(account: BankAccountConfig): Promise<PlatformHealth> {
    const startedAt = Date.now()
    try {
      await revolutGet(account.accessToken, '/accounts')
      return { status: 'healthy', latencyMs: Date.now() - startedAt }
    } catch (err) {
      return { status: 'down', message: String(err) }
    }
  },
}
