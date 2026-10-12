import { eq } from 'drizzle-orm'
import { refreshTokens } from '../../connectors/revolut/oauth.js'
import type { RevolutTokens } from '../../connectors/revolut/types.js'
import { db } from '../db/client.js'
import { bankAccounts } from '../db/schema/index.js'
import { decryptApiKey, encryptApiKey } from './crypto.js'
import { sendAlertEmail } from './email.js'
import { tr } from './i18n.js'

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
    tr('emails.revolut.reauthSubject'),
    tr('emails.revolut.reauthBody1', { name: row?.name ?? accountId, reason }) +
      tr('emails.revolut.reauthBody2'),
  )
}

/**
 * Sesiune Revolut gata de folosit: decriptează access token-ul și îl reîmprospătează
 * automat dacă e aproape de expirare. Aruncă mesaje descriptive dacă contul nu e
 * configurat sau necesită reautentificare manuală.
 */
export async function getRevolutSession(accountId: string): Promise<{ accessToken: string }> {
  const row = await getBankAccountRow(accountId)
  if (!row) throw new Error(tr('errors.reconciliation.accountNotFound'))

  if (row.authStatus === 'unconfigured' || !row.accessTokenEnc || !row.refreshTokenEnc) {
    throw new Error(
      tr('errors.revolut.notConfigured', { name: row.name }),
    )
  }
  if (row.authStatus === 'needs_reauth') {
    throw new Error(
      tr('errors.revolut.needsReauth', { name: row.name }),
    )
  }
  if (!row.clientId || !row.privateKeyEnc) {
    throw new Error(tr('errors.revolut.noClientIdOrCert', { name: row.name }))
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
    throw new Error(tr('errors.revolut.refreshFailed', { name: row.name, err: String(err) }))
  }
}
