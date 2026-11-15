import { createHash, randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { apiTokens } from '../db/schema/index.js'
import { effectiveFeatures, type SessionUser } from './session.js'

export const API_TOKEN_PREFIX = 'vd_'
// Technical constants, not company settings: the per-token request budget and how often the
// "last used" columns are written.
export const API_TOKEN_RATE_LIMIT_PER_MIN = 120
export const API_TOKEN_LAST_USED_INTERVAL_MS = 60_000

/**
 * Paths a token can never reach, whatever its features: signing in and out, the person's password,
 * creating or revoking tokens, changing people or roles, and the platform admin's routes. A leaked token must not be able to mint another
 * one or lock its owner out. `GET /api/auth/me` stays open so a client can see its effective rights.
 */
const TOKEN_DENIED_PREFIXES = ['/api/auth', '/api/me/api-tokens', '/api/me/sessions', '/api/admin/api-tokens', '/api/team', '/api/access', '/api/platform']

export function isPathDeniedToTokens(method: string, routeUrl: string): boolean {
  if (routeUrl === '/api/auth/me' && method === 'GET') return false
  return TOKEN_DENIED_PREFIXES.some((prefix) => routeUrl === prefix || routeUrl.startsWith(`${prefix}/`))
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateApiToken(): { token: string; hash: string; prefix: string } {
  const secret = randomBytes(32).toString('base64url')
  const token = `${API_TOKEN_PREFIX}${secret}`
  return { token, hash: hashApiToken(token), prefix: secret.slice(0, 8) }
}

/** The `vd_…` value of an `Authorization: Bearer` header, `''` for a Bearer without it, null if no Bearer. */
export function bearerFromHeader(header: string | undefined): string | null {
  if (!header || !/^bearer /i.test(header)) return null
  const value = header.slice(7).trim()
  return value.startsWith(API_TOKEN_PREFIX) ? value : ''
}

export type ApiTokenRow = typeof apiTokens.$inferSelect

/** The token row if it exists, is not revoked and has not expired. Caller runs it with the RLS bypass. */
export async function findUsableApiToken(token: string, now = new Date()): Promise<ApiTokenRow | null> {
  const [row] = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hashApiToken(token))).limit(1)
  if (!row || row.revokedAt) return null
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return null
  return row
}

/** The person's features narrowed to the token's subset, with the page gates applied again. */
export function tokenFeatures(me: SessionUser, tokenSubset: string[] | null): string[] {
  if (!tokenSubset) return me.features
  const allowed = new Set(tokenSubset)
  return effectiveFeatures(
    me.features.filter((key) => allowed.has(key)),
    'custom',
    me.tenant,
  )
}

/**
 * Revokes every live token of a person. Called wherever their password changes or the account is
 * closed: a reset or a new password usually follows a suspicion, and a token must not outlive it.
 */
export async function revokeUserApiTokens(userId: string, executor: Pick<typeof db, 'update'> = db): Promise<void> {
  const now = new Date()
  await executor
    .update(apiTokens)
    .set({ revokedAt: now, updatedAt: now })
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
}
