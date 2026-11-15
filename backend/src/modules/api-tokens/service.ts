import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { apiTokens, users } from '../../shared/db/schema/index.js'
import { recordAudit } from '../../shared/lib/audit.js'
import { generateApiToken } from '../../shared/lib/api-tokens.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { availableFeatures, featureLabel, pageLabel, PAGES } from '../../shared/lib/features.js'

const DEFAULT_EXPIRY_DAYS = 90
const DAY_MS = 86_400_000

const tokenColumns = {
  id: apiTokens.id,
  name: apiTokens.name,
  prefix: apiTokens.prefix,
  features: apiTokens.features,
  expiresAt: apiTokens.expiresAt,
  lastUsedAt: apiTokens.lastUsedAt,
  lastUsedIp: apiTokens.lastUsedIp,
  revokedAt: apiTokens.revokedAt,
  createdAt: apiTokens.createdAt,
}

export async function listOwnTokens(userId: string) {
  return db.select(tokenColumns).from(apiTokens).where(eq(apiTokens.userId, userId)).orderBy(desc(apiTokens.createdAt))
}

export async function listCompanyTokens() {
  const rows = await db
    .select({ ...tokenColumns, userId: users.id, displayName: users.displayName, email: users.email })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(isNull(apiTokens.revokedAt))
    .orderBy(desc(apiTokens.createdAt))
  return rows.map(({ userId, displayName, email, ...item }) => ({ ...item, user: { id: userId, displayName, email } }))
}

export type CreateTokenResult =
  | { ok: true; token: string; item: Awaited<ReturnType<typeof listOwnTokens>>[number] }
  | { ok: false; reason: 'FEATURE_FORBIDDEN' | 'FEATURES_NOT_IN_ROLE' }

export async function createToken(
  me: SessionUser,
  input: { name: string; features?: string[]; expiresInDays?: 30 | 90 | 365 | null },
): Promise<CreateTokenResult> {
  if (!me.features.includes('echipa.tokenuri')) return { ok: false, reason: 'FEATURE_FORBIDDEN' }
  if (input.features?.some((key) => !me.features.includes(key))) return { ok: false, reason: 'FEATURES_NOT_IN_ROLE' }

  const days = input.expiresInDays === undefined ? DEFAULT_EXPIRY_DAYS : input.expiresInDays
  // Without an explicit list a token gets only the page gates the person has (read access): writing,
  // sending email or placing orders must be chosen on purpose.
  const features = input.features ?? me.features.filter((key) => key.endsWith('.view'))
  const { token, hash, prefix } = generateApiToken()
  const item = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(apiTokens)
      .values({
        userId: me.id,
        name: input.name,
        tokenHash: hash,
        prefix,
        features,
        expiresAt: days === null ? null : new Date(Date.now() + days * DAY_MS),
      })
      .returning(tokenColumns)
    if (!row) throw new Error('api_tokens insert returned no row')
    await recordAudit({
      action: 'api_token.creat',
      entityType: 'api_token',
      entityId: row.id,
      changes: { name: [null, input.name] },
      executor: tx,
    })
    return row
  })
  return { ok: true, token, item }
}

/** Revokes one token; `userId` set = only that person's. False when no such token exists. */
export async function revokeToken(tokenId: string, userId?: string): Promise<boolean> {
  const conditions = [eq(apiTokens.id, tokenId)]
  if (userId) conditions.push(eq(apiTokens.userId, userId))
  const [found] = await db
    .select({ id: apiTokens.id, name: apiTokens.name, revokedAt: apiTokens.revokedAt })
    .from(apiTokens)
    .where(and(...conditions))
  if (!found) return false
  if (found.revokedAt) return true
  await db.transaction(async (tx) => {
    await tx
      .update(apiTokens)
      .set({ revokedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(apiTokens.id, tokenId), isNull(apiTokens.revokedAt)))
    await recordAudit({
      action: 'api_token.revocat',
      entityType: 'api_token',
      entityId: tokenId,
      changes: { name: [found.name, null] },
      executor: tx,
    })
  })
  return true
}

/**
 * Labels for the token dialog, only for the features the person has: the Modules catalog
 * (`/api/access/catalog`) needs `echipa.administrare`, which a colleague does not have.
 */
export function ownFeatureLabels(me: SessionUser): Array<{ key: string; label: string }> {
  const granted = new Set(me.features)
  const out: Array<{ key: string; label: string }> = []
  for (const page of PAGES) {
    for (const feature of availableFeatures()) {
      if (feature.page !== page.key || !granted.has(feature.key)) continue
      const label = feature.key === page.viewFeature ? pageLabel(page.key) : `${pageLabel(page.key)}: ${featureLabel(feature.key)}`
      out.push({ key: feature.key, label })
    }
  }
  return out
}
