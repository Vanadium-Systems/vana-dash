import cron from 'node-cron'
import { refreshTokens } from '../connectors/anaf/oauth.js'
import { getAnafCredentialsRow, markNeedsReauth, saveAnafTokens } from '../shared/lib/anaf.js'
import { decryptApiKey } from '../shared/lib/crypto.js'

// Reînnoiește access token-ul ANAF înainte de expirare. Dacă refresh-ul pică
// (refresh token expirat/revocat), marchează needs_reauth + email — NU putem
// reautentifica singuri: consimțirea cere certificatul digital al lui Stefan.

const CRON_EXPR = '15 3 * * *'
const REFRESH_IF_EXPIRES_WITHIN_MS = 48 * 60 * 60 * 1000

export function startAnafTokenRefreshJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void refreshAnafTokenIfNeeded()
  })
  console.log(`[refresh-anaf-token] Scheduled (${CRON_EXPR})`)
}

export async function refreshAnafTokenIfNeeded(): Promise<void> {
  const row = await getAnafCredentialsRow()
  if (!row || row.status !== 'active' || !row.refreshTokenEnc) return

  const expiresSoon = !row.expiresAt || row.expiresAt.getTime() - Date.now() < REFRESH_IF_EXPIRES_WITHIN_MS
  if (!expiresSoon) return

  try {
    const tokens = await refreshTokens(decryptApiKey(row.refreshTokenEnc))
    await saveAnafTokens(row.cif, tokens)
    console.log('[refresh-anaf-token] Token ANAF reînnoit')
  } catch (err) {
    console.error(`[refresh-anaf-token] Refresh eșuat: ${String(err)}`)
    await markNeedsReauth(row.id, String(err))
  }
}
