import { eq, isNull } from 'drizzle-orm'
import { refreshTokens } from '../../connectors/anaf/oauth.js'
import type { AnafTokens } from '../../connectors/anaf/types.js'
import type { AnafSession } from '../../connectors/types.js'
import { db } from '../db/client.js'
import { anafCredentials } from '../db/schema/index.js'
import { decryptApiKey, encryptApiKey } from './crypto.js'
import { sendAlertEmail } from './email.js'

// Gestionarea credențialelor ANAF: un singur rând activ (CIF-ul Vanadium).
// Token-urile stau criptate în DB și sunt decriptate doar în memorie, per call.

/** Refresh cu 1h înainte de expirare, ca să nu prindem niciodată un token mort în zbor. */
const REFRESH_MARGIN_MS = 60 * 60 * 1000

export async function getAnafCredentialsRow() {
  const [row] = await db.select().from(anafCredentials).where(isNull(anafCredentials.deletedAt)).limit(1)
  return row ?? null
}

export async function saveAnafTokens(cif: string, tokens: AnafTokens): Promise<void> {
  const existing = await getAnafCredentialsRow()
  const values = {
    accessTokenEnc: encryptApiKey(tokens.accessToken),
    refreshTokenEnc: encryptApiKey(tokens.refreshToken),
    expiresAt: tokens.expiresAt,
    lastRefreshedAt: new Date(),
    status: 'active' as const,
    updatedAt: new Date(),
  }
  if (existing) {
    await db.update(anafCredentials).set({ ...values, cif }).where(eq(anafCredentials.id, existing.id))
  } else {
    await db.insert(anafCredentials).values({ ...values, cif })
  }
}

export async function markNeedsReauth(id: string, reason: string): Promise<void> {
  await db
    .update(anafCredentials)
    .set({ status: 'needs_reauth', updatedAt: new Date() })
    .where(eq(anafCredentials.id, id))
  await sendAlertEmail(
    'ANAF: reautentificare necesară',
    `Refresh token-ul ANAF a expirat sau a fost revocat (${reason}).\n` +
      'Intră în vana-dash → Accounting → Settings și refă consimțirea cu certificatul digital.',
  )
}

/**
 * Sesiune ANAF gata de folosit: decriptează access token-ul și îl reîmprospătează
 * automat dacă e aproape de expirare. Aruncă dacă nu există credențiale active.
 */
export async function getAnafSession(): Promise<AnafSession> {
  const row = await getAnafCredentialsRow()
  if (!row || row.status === 'unconfigured' || !row.accessTokenEnc || !row.refreshTokenEnc) {
    throw new Error('ANAF neconfigurat: fă consimțirea OAuth din Accounting → Settings')
  }
  if (row.status === 'needs_reauth') {
    throw new Error('ANAF necesită reautentificare manuală (refresh token expirat/revocat)')
  }

  const needsRefresh = !row.expiresAt || row.expiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS
  if (!needsRefresh) {
    return { cif: row.cif, accessToken: decryptApiKey(row.accessTokenEnc) }
  }

  try {
    const tokens = await refreshTokens(decryptApiKey(row.refreshTokenEnc))
    await saveAnafTokens(row.cif, tokens)
    return { cif: row.cif, accessToken: tokens.accessToken }
  } catch (err) {
    await markNeedsReauth(row.id, String(err))
    throw new Error(`ANAF token refresh eșuat: ${String(err)}`)
  }
}
