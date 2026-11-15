import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { and, desc, eq, isNull, ne, sql, TransactionRollbackError } from 'drizzle-orm'
import { db } from '../db/client.js'
import { userSessions } from '../db/schema/index.js'

// Long sessions: a short access JWT (cookie `vana_session`) plus a rotating refresh token (cookie
// `vana_refresh`, only sent to /api/auth). The refresh token lives 60 days from its last use, so a
// person who opens the app at least once in that window never logs in again.

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60
export const REFRESH_IDLE_DAYS = 60
export const REFRESH_COOKIE = 'vana_refresh'
export const REFRESH_COOKIE_PATH = '/api/auth'
// Two requests of the same tab can refresh at the same moment with the same cookie. The second one
// inside this window gets an access token for the new row instead of tripping reuse detection.
const ROTATION_GRACE_MS = 30_000
// Sensitive actions ask for the password again when the last confirmation is older than this.
export const PASSWORD_CONFIRM_WINDOW_MS = 10 * 60_000

const DAY_MS = 86_400_000

export type SessionRow = typeof userSessions.$inferSelect

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function newRefreshSecret(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashRefreshToken(token) }
}

const expiry = (from = Date.now()) => new Date(from + REFRESH_IDLE_DAYS * DAY_MS)

/** "Chrome · Android", "Firefox · Linux", … from the User-Agent; null when nothing is recognised. */
export function deviceLabel(userAgent: string | undefined): string | null {
  if (!userAgent) return null
  const ua = userAgent
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /curl\//.test(ua) ? 'curl'
    : null
  const os =
    /Android/.test(ua) ? 'Android'
    : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : null
  const label = [browser, os].filter(Boolean).join(' · ')
  return label || null
}

export interface ClientInfo {
  ip: string
  userAgent?: string
}

/** A new family, at login (or invite accept, or a password change on this device). */
export async function startSession(
  userId: string,
  sessionVersion: number,
  client: ClientInfo,
  passwordTyped = true,
): Promise<{ sessionId: string; refreshToken: string }> {
  const { token, hash } = newRefreshSecret()
  const [row] = await db
    .insert(userSessions)
    .values({
      userId,
      familyId: randomUUID(),
      tokenHash: hash,
      sessionVersion,
      deviceLabel: deviceLabel(client.userAgent),
      ip: client.ip,
      expiresAt: expiry(),
      // Typing the password to log in counts as a confirmation; moving an old cookie over does not.
      passwordConfirmedAt: passwordTyped ? new Date() : null,
    })
    .returning({ id: userSessions.id })
  if (!row) throw new Error('user_sessions insert returned no row')
  return { sessionId: row.id, refreshToken: token }
}

export type RotateResult =
  | { kind: 'rotated'; session: SessionRow; refreshToken: string }
  /** A parallel request inside the grace window: new access token for `session`, cookie untouched. */
  | { kind: 'grace'; session: SessionRow }
  /** A replaced token came back after the window: the family was revoked. */
  | { kind: 'reuse'; userId: string; familyId: string }
  | { kind: 'invalid' }

/**
 * Exchanges a refresh token for a new one. Run with the RLS bypass: the company is not known
 * before the row is read (same as the session user lookup).
 */
export async function rotateSession(token: string, client: ClientInfo, now = new Date()): Promise<RotateResult> {
  const [row] = await db.select().from(userSessions).where(eq(userSessions.tokenHash, hashRefreshToken(token))).limit(1)
  if (!row) return { kind: 'invalid' }

  if (row.revokedAt) {
    if (row.revokeReason !== 'rotated' || !row.replacedById) return { kind: 'invalid' }
    if (now.getTime() - row.revokedAt.getTime() <= ROTATION_GRACE_MS) {
      const [next] = await db.select().from(userSessions).where(eq(userSessions.id, row.replacedById)).limit(1)
      return next && !next.revokedAt ? { kind: 'grace', session: next } : { kind: 'invalid' }
    }
    await revokeFamily(row.familyId, 'reuse')
    return { kind: 'reuse', userId: row.userId, familyId: row.familyId }
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    await db.update(userSessions).set({ revokedAt: now, revokeReason: 'expired' }).where(eq(userSessions.id, row.id))
    return { kind: 'invalid' }
  }

  const { token: nextToken, hash } = newRefreshSecret()
  let rotated: SessionRow | null = null
  try {
    rotated = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(userSessions)
      .values({
        tenantId: row.tenantId,
        userId: row.userId,
        familyId: row.familyId,
        tokenHash: hash,
        sessionVersion: row.sessionVersion,
        deviceLabel: deviceLabel(client.userAgent) ?? row.deviceLabel,
        ip: client.ip,
        createdAt: row.createdAt,
        lastUsedAt: now,
        expiresAt: expiry(now.getTime()),
        passwordConfirmedAt: row.passwordConfirmedAt,
      })
      .returning()
    // Conditional on the row still being live: of two refreshes racing on the same token, one wins
    // and the other takes the grace path on its next attempt.
    const [replaced] = await tx
      .update(userSessions)
      .set({ revokedAt: now, revokeReason: 'rotated', replacedById: inserted!.id })
      .where(and(eq(userSessions.id, row.id), isNull(userSessions.revokedAt)))
      .returning({ id: userSessions.id })
    if (!replaced) {
      tx.rollback()
    }
    return inserted!
    })
  } catch (error) {
    // Lost the race: the row is now 'rotated', so the second pass below takes the grace path.
    if (!(error instanceof TransactionRollbackError)) throw error
  }
  if (!rotated) return rotateSession(token, client, now)
  return { kind: 'rotated', session: rotated, refreshToken: nextToken }
}

/**
 * Whether the access token's session still stands. A row replaced by rotation stays usable for the
 * rest of its access token's 15 minutes; one revoked for any other reason does not.
 */
export async function isSessionUsable(sessionId: string): Promise<SessionRow | null> {
  const [row] = await db.select().from(userSessions).where(eq(userSessions.id, sessionId)).limit(1)
  if (!row) return null
  if (row.revokedAt && row.revokeReason !== 'rotated') return null
  return row
}

export async function revokeFamily(familyId: string, reason: string): Promise<void> {
  await db
    .update(userSessions)
    .set({ revokedAt: sql`COALESCE(${userSessions.revokedAt}, now())`, revokeReason: reason })
    .where(eq(userSessions.familyId, familyId))
}

/** Every session of a person, optionally keeping one family (the device doing it). */
export async function revokeUserSessions(
  userId: string,
  reason: string,
  keepFamilyId?: string,
  executor: Pick<typeof db, 'update'> = db,
): Promise<void> {
  // Rotated rows too: an access token issued just before the last rotation still points at one.
  const conditions = [eq(userSessions.userId, userId), sql`${userSessions.revokeReason} IS DISTINCT FROM ${reason}`]
  if (keepFamilyId) conditions.push(ne(userSessions.familyId, keepFamilyId))
  await executor
    .update(userSessions)
    .set({ revokedAt: sql`COALESCE(${userSessions.revokedAt}, now())`, revokeReason: reason })
    .where(and(...conditions))
}

/** The live row of each family: one line per device in "Dispozitive". */
export async function listUserDevices(userId: string) {
  return db
    .select({
      familyId: userSessions.familyId,
      deviceLabel: userSessions.deviceLabel,
      ip: userSessions.ip,
      createdAt: userSessions.createdAt,
      lastUsedAt: userSessions.lastUsedAt,
    })
    .from(userSessions)
    .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)))
    .orderBy(desc(userSessions.lastUsedAt))
}

/** On the family's live row, so the confirmation survives the next rotation. */
export async function markPasswordConfirmed(familyId: string): Promise<void> {
  await db
    .update(userSessions)
    .set({ passwordConfirmedAt: new Date() })
    .where(and(eq(userSessions.familyId, familyId), isNull(userSessions.revokedAt)))
}

/**
 * True when a sensitive action must ask for the password first: a long session whose last
 * confirmation is older than the window. Only cookie sessions are asked (tokens cannot reach these
 * routes); a 7-day cookie from before long sessions is not, it moves over on its next page load.
 */
export function passwordConfirmRequired(session: { passwordConfirmedAt: Date | null } | null, now = Date.now()): boolean {
  if (!session) return false
  return !session.passwordConfirmedAt || now - session.passwordConfirmedAt.getTime() > PASSWORD_CONFIRM_WINDOW_MS
}

export const PASSWORD_CONFIRM_REQUIRED = { success: false, error: { code: 'PASSWORD_CONFIRM_REQUIRED' } } as const

/** Rows revoked or expired more than 30 days ago: nothing reads them any more. */
export async function deleteOldSessions(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 30 * DAY_MS)
  const deleted = await db
    .delete(userSessions)
    .where(sql`COALESCE(${userSessions.revokedAt}, ${userSessions.expiresAt}) < ${cutoff}`)
    .returning({ id: userSessions.id })
  return deleted.length
}
