import cron from 'node-cron'
import { and, eq, isNull } from 'drizzle-orm'
import { refreshTokens } from '../connectors/revolut/oauth.js'
import { db } from '../shared/db/client.js'
import { bankAccounts } from '../shared/db/schema/index.js'
import { decryptApiKey } from '../shared/lib/crypto.js'
import { markNeedsReauth, saveRevolutTokens } from '../shared/lib/revolut.js'
import { tr } from '../shared/lib/i18n.js'

// Reînnoiește access token-ul Revolut al fiecărui cont bancar OAuth înainte de
// expirare. Spre deosebire de ANAF (un singur rând, singleton pe CIF), aici
// iterăm TOATE conturile bank_accounts cu provider='revolut' — fiecare rând
// are propriul client_id + certificat, deci un eșec pe un cont NU trebuie să
// oprească refresh-ul celorlalte (CLAUDE.md regula 7 — connector failure izolat).
//
// Access token Revolut trăiește doar 40 min total — marja de refresh trebuie
// să rămână sub asta cu spațiu de siguranță generos (cron rulează la 25 min,
// prag de refresh la 15 min rămase).

const CRON_EXPR = '*/25 * * * *'
const REFRESH_IF_EXPIRES_WITHIN_MS = 15 * 60 * 1000

export function startRevolutTokenRefreshJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void refreshRevolutTokensIfNeeded()
  })
  console.log(`[refresh-revolut-token] Scheduled (${CRON_EXPR})`)
}

export async function refreshRevolutTokensIfNeeded(): Promise<void> {
  const rows = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.provider, 'revolut'), eq(bankAccounts.authStatus, 'active'), isNull(bankAccounts.deletedAt)))

  for (const row of rows) {
    // Failure izolat per cont — un cont broken nu oprește refresh-ul altora.
    try {
      await refreshOne(row)
    } catch (err) {
      console.error(`[refresh-revolut-token] Refresh eșuat pentru contul ${row.id}: ${String(err)}`)
      await markNeedsReauth(row.id, String(err))
    }
  }
}

async function refreshOne(row: typeof bankAccounts.$inferSelect): Promise<void> {
  if (!row.clientId || !row.privateKeyEnc || !row.refreshTokenEnc) {
    throw new Error(tr('errors.revolut.accountIncomplete'))
  }

  const expiresSoon =
    !row.tokenExpiresAt || row.tokenExpiresAt.getTime() - Date.now() < REFRESH_IF_EXPIRES_WITHIN_MS
  if (!expiresSoon) return

  const refreshToken = decryptApiKey(row.refreshTokenEnc)
  const privateKeyPem = decryptApiKey(row.privateKeyEnc)

  const tokens = await refreshTokens(refreshToken, row.clientId, privateKeyPem)
  await saveRevolutTokens(row.id, tokens)
  console.log(`[refresh-revolut-token] Token Revolut reînnoit (cont ${row.id})`)
}
