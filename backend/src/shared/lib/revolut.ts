import { eq } from 'drizzle-orm'
import { refreshTokens } from '../../connectors/revolut/oauth.js'
import type { RevolutTokens } from '../../connectors/revolut/types.js'
import { db } from '../db/client.js'
import { bankAccounts } from '../db/schema/index.js'
import { decryptApiKey, encryptApiKey } from './crypto.js'
import { sendAlertEmail } from './email.js'

// Gestionarea credențialelor Revolut per cont bancar — mirror pe shared/lib/anaf.ts,
// dar `bank_accounts` e un TABEL (mai multe rânduri), nu un singleton ca `anaf_credentials`.
// Fiecare rând are propriul client_id + certificat, deci sesiunea se cere per accountId.

/**
 * Refresh cu 5 minute înainte de expirare. Access token-ul Revolut trăiește doar
 * 40 min (mult mai scurt ca la ANAF, unde marja e 1h) — o marjă mai mare ar declanșa
 * refresh la aproape orice request.
 */
const REFRESH_MARGIN_MS = 5 * 60 * 1000

/** Selecție completă, inclusiv secretele — folosit DOAR intern (refresh/exchange), NICIODATĂ expus prin service.ts. */
export async function getBankAccountRow(id: string) {
  const [row] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, id)).limit(1)
  return row ?? null
}

export async function saveRevolutTokens(accountId: string, tokens: RevolutTokens): Promise<void> {
  await db
    .update(bankAccounts)
    .set({
      accessTokenEnc: encryptApiKey(tokens.accessToken),
      refreshTokenEnc: encryptApiKey(tokens.refreshToken),
      tokenExpiresAt: tokens.expiresAt,
      lastRefreshedAt: new Date(),
      authStatus: 'active',
      updatedAt: new Date(),
    })
    .where(eq(bankAccounts.id, accountId))
}

export async function markNeedsReauth(accountId: string, reason: string): Promise<void> {
  const row = await getBankAccountRow(accountId)
  await db
    .update(bankAccounts)
    .set({ authStatus: 'needs_reauth', updatedAt: new Date() })
    .where(eq(bankAccounts.id, accountId))
  await sendAlertEmail(
    'Revolut: reautentificare necesară',
    `Refresh token-ul Revolut pentru contul "${row?.name ?? accountId}" a expirat sau a fost revocat (${reason}).\n` +
      'Intră în vana-dash → Reconciliere → Setări cont bancar și refă consimțirea OAuth din browser.',
  )
}

/**
 * Sesiune Revolut gata de folosit: decriptează access token-ul și îl reîmprospătează
 * automat dacă e aproape de expirare. Aruncă mesaje descriptive dacă contul nu e
 * configurat sau necesită reautentificare manuală.
 */
export async function getRevolutSession(accountId: string): Promise<{ accessToken: string }> {
  const row = await getBankAccountRow(accountId)
  if (!row) throw new Error('Cont bancar inexistent')

  if (row.authStatus === 'unconfigured' || !row.accessTokenEnc || !row.refreshTokenEnc) {
    throw new Error(
      `Revolut neconfigurat pentru contul "${row.name}": setează client_id, generează certificatul și fă consimțirea OAuth din Reconciliere → Setări`,
    )
  }
  if (row.authStatus === 'needs_reauth') {
    throw new Error(
      `Revolut necesită reautentificare manuală pentru contul "${row.name}" (refresh token expirat/revocat)`,
    )
  }
  if (!row.clientId || !row.privateKeyEnc) {
    throw new Error(`Revolut: contul "${row.name}" nu are client_id sau certificat configurat`)
  }

  const needsRefresh = !row.tokenExpiresAt || row.tokenExpiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS
  if (!needsRefresh) {
    return { accessToken: decryptApiKey(row.accessTokenEnc) }
  }

  try {
    const refreshToken = decryptApiKey(row.refreshTokenEnc)
    const privateKeyPem = decryptApiKey(row.privateKeyEnc)
    const tokens = await refreshTokens(refreshToken, row.clientId, privateKeyPem)
    await saveRevolutTokens(accountId, tokens)
    return { accessToken: tokens.accessToken }
  } catch (err) {
    await markNeedsReauth(accountId, String(err))
    throw new Error(`Revolut token refresh eșuat pentru contul "${row.name}": ${String(err)}`)
  }
}
