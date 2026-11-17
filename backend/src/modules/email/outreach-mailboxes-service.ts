import { and, asc, eq, gte, isNull, notInArray, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { emailSends, outreachMailboxes } from '../../shared/db/schema/index.js'
import { decryptField, encryptField } from '../../shared/lib/crypto.js'
import { evictSmtpPool, isLocalSmtpHost, sendViaSmtp, type SmtpErrorCode } from '../../shared/lib/smtp.js'
import type { OutreachMailboxCreateSchema, OutreachMailboxUpdateSchema } from './outreach-mailboxes-schema.js'
import { getEmailSettings } from './settings-service.js'

type OutreachMailboxRow = typeof outreachMailboxes.$inferSelect

export interface PublicOutreachMailbox {
  id: string
  address: string
  displayName: string
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  imapHost: string | null
  imapPort: number | null
  imapSecure: boolean
  authKind: 'password' | 'oauth2'
  dailyCap: number
  effectiveCap: number
  usedToday: number
  remainingToday: number
  warmupUntil: Date | null
  status: 'active' | 'paused' | 'error'
  lastErrorCode: string | null
  lastSentAt: Date | null
  lastTestedAt: Date | null
  lastImapCheckAt: Date | null
  createdAt: Date
}

export interface OutreachMailboxSummary {
  id: string
  address: string
  displayName: string
  status: 'active' | 'paused' | 'error'
  dailyCap: number
  effectiveCap: number
  usedToday: number
  remainingToday: number
  warmupUntil: Date | null
  lastSentAt: Date | null
  lastErrorCode: string | null
}

function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/**
 * Linear warm-up ramp from 20% (min 2) of `dailyCap` at `createdAt` up to 100% at `warmupUntil`.
 * Once `now >= warmupUntil` (or when `warmupUntil` is null), returns the full `dailyCap`.
 */
export function effectiveDailyCap(
  mailbox: Pick<OutreachMailboxRow, 'dailyCap' | 'warmupUntil' | 'createdAt'>,
  now = new Date(),
): number {
  if (!mailbox.warmupUntil || now >= mailbox.warmupUntil) return mailbox.dailyCap
  const totalMs = Math.max(1, mailbox.warmupUntil.getTime() - mailbox.createdAt.getTime())
  const elapsedMs = Math.max(0, now.getTime() - mailbox.createdAt.getTime())
  const progress = Math.min(1, elapsedMs / totalMs)
  const startCap = Math.min(mailbox.dailyCap, Math.max(2, Math.ceil(mailbox.dailyCap * 0.2)))
  return Math.min(mailbox.dailyCap, Math.max(1, Math.round(startCap + (mailbox.dailyCap - startCap) * progress)))
}

/** SQL COUNT per outreach_mailbox_id for today (UTC), excluding failed and cancelled sends. */
export async function countUsedTodayByMailbox(now = new Date()): Promise<Map<string, number>> {
  const rows = await db
    .select({
      mailboxId: emailSends.outreachMailboxId,
      count: sql<number>`COUNT(*)::int`,
    })
    .from(emailSends)
    .where(
      and(
        isNull(emailSends.deletedAt),
        sql`${emailSends.outreachMailboxId} IS NOT NULL`,
        gte(emailSends.createdAt, startOfUtcDay(now)),
        notInArray(emailSends.status, ['failed', 'cancelled']),
      ),
    )
    .groupBy(emailSends.outreachMailboxId)

  const map = new Map<string, number>()
  for (const r of rows) {
    if (r.mailboxId) map.set(r.mailboxId, r.count)
  }
  return map
}

function toPublicMailbox(row: OutreachMailboxRow, usedToday: number, now = new Date()): PublicOutreachMailbox {
  const effectiveCap = effectiveDailyCap(row, now)
  return {
    id: row.id,
    address: row.address,
    displayName: row.displayName,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpSecure: row.smtpSecure,
    imapHost: row.imapHost,
    imapPort: row.imapPort,
    imapSecure: row.imapSecure,
    authKind: row.authKind,
    dailyCap: row.dailyCap,
    effectiveCap,
    usedToday,
    remainingToday: Math.max(0, effectiveCap - usedToday),
    warmupUntil: row.warmupUntil,
    status: row.status,
    lastErrorCode: row.lastErrorCode,
    lastSentAt: row.lastSentAt,
    lastTestedAt: row.lastTestedAt,
    lastImapCheckAt: row.lastImapCheckAt,
    createdAt: row.createdAt,
  }
}

export async function listOutreachMailboxes(): Promise<PublicOutreachMailbox[]> {
  const [rows, usedMap] = await Promise.all([
    db
      .select()
      .from(outreachMailboxes)
      .where(isNull(outreachMailboxes.deletedAt))
      .orderBy(asc(outreachMailboxes.createdAt)),
    countUsedTodayByMailbox(),
  ])
  const now = new Date()
  return rows.map((row) => toPublicMailbox(row, usedMap.get(row.id) ?? 0, now))
}

export async function listOutreachMailboxSummaries(): Promise<OutreachMailboxSummary[]> {
  const list = await listOutreachMailboxes()
  return list.map((m) => ({
    id: m.id,
    address: m.address,
    displayName: m.displayName,
    status: m.status,
    dailyCap: m.dailyCap,
    effectiveCap: m.effectiveCap,
    usedToday: m.usedToday,
    remainingToday: m.remainingToday,
    warmupUntil: m.warmupUntil,
    lastSentAt: m.lastSentAt,
    lastErrorCode: m.lastErrorCode,
  }))
}

export async function hasConfiguredOutreachMailboxes(): Promise<boolean> {
  const [row] = await db
    .select({ id: outreachMailboxes.id })
    .from(outreachMailboxes)
    .where(isNull(outreachMailboxes.deletedAt))
    .limit(1)
  return Boolean(row)
}

export async function getOutreachMailboxAggregateCap(): Promise<{ cap: number; usedToday: number; remaining: number }> {
  const list = await listOutreachMailboxes()
  const active = list.filter((m) => m.status === 'active')
  const cap = active.reduce((sum, m) => sum + m.effectiveCap, 0)
  const usedToday = active.reduce((sum, m) => sum + m.usedToday, 0)
  const remaining = active.reduce((sum, m) => sum + m.remainingToday, 0)
  return { cap, usedToday, remaining }
}

export async function createOutreachMailbox(input: z.infer<typeof OutreachMailboxCreateSchema>): Promise<PublicOutreachMailbox> {
  const secretEnc = await encryptField(input.secret)
  const [row] = await db
    .insert(outreachMailboxes)
    .values({
      address: input.address.toLowerCase(),
      displayName: input.displayName,
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      smtpSecure: input.smtpSecure,
      imapHost: input.imapHost ?? null,
      imapPort: input.imapPort ?? null,
      imapSecure: input.imapSecure,
      authKind: input.authKind,
      secretEnc,
      dailyCap: input.dailyCap,
      warmupUntil: input.warmupUntil ? new Date(input.warmupUntil) : null,
    })
    .returning()
  if (!row) throw new Error('Failed to create outreach mailbox')
  return toPublicMailbox(row, 0)
}

export async function updateOutreachMailbox(
  id: string,
  input: z.infer<typeof OutreachMailboxUpdateSchema>,
): Promise<PublicOutreachMailbox | null> {
  const patch: Partial<typeof outreachMailboxes.$inferInsert> = {
    updatedAt: new Date(),
  }
  if (input.address !== undefined) patch.address = input.address.toLowerCase()
  if (input.displayName !== undefined) patch.displayName = input.displayName
  if (input.smtpHost !== undefined) patch.smtpHost = input.smtpHost
  if (input.smtpPort !== undefined) patch.smtpPort = input.smtpPort
  if (input.smtpSecure !== undefined) patch.smtpSecure = input.smtpSecure
  if (input.imapHost !== undefined) patch.imapHost = input.imapHost
  if (input.imapPort !== undefined) patch.imapPort = input.imapPort
  if (input.imapSecure !== undefined) patch.imapSecure = input.imapSecure
  if (input.dailyCap !== undefined) patch.dailyCap = input.dailyCap
  if (input.warmupUntil !== undefined) patch.warmupUntil = input.warmupUntil ? new Date(input.warmupUntil) : null
  if (input.status !== undefined) {
    patch.status = input.status
    if (input.status === 'active') patch.lastErrorCode = null
  }
  if (input.secret !== undefined && input.secret.length > 0) {
    patch.secretEnc = await encryptField(input.secret)
  }

  const [row] = await db
    .update(outreachMailboxes)
    .set(patch)
    .where(and(eq(outreachMailboxes.id, id), isNull(outreachMailboxes.deletedAt)))
    .returning()
  if (!row) return null

  evictSmtpPool(id)
  const usedMap = await countUsedTodayByMailbox()
  return toPublicMailbox(row, usedMap.get(row.id) ?? 0)
}

export async function softDeleteOutreachMailbox(id: string): Promise<boolean> {
  const [row] = await db
    .update(outreachMailboxes)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(outreachMailboxes.id, id), isNull(outreachMailboxes.deletedAt)))
    .returning({ id: outreachMailboxes.id })
  if (!row) return false
  evictSmtpPool(id)
  return true
}

export function formatMailboxFrom(mailbox: Pick<OutreachMailboxRow, 'address' | 'displayName'>): string {
  return mailbox.displayName ? `${mailbox.displayName} <${mailbox.address}>` : mailbox.address
}

export type OutreachTestResult =
  | { ok: true }
  | { ok: false; code: SmtpErrorCode | 'OUTREACH_REAL_SENDING_DISABLED' | 'NOT_FOUND' }

export async function testOutreachMailbox(id: string, toAddress: string): Promise<OutreachTestResult> {
  const [row] = await db
    .select()
    .from(outreachMailboxes)
    .where(and(eq(outreachMailboxes.id, id), isNull(outreachMailboxes.deletedAt)))
  if (!row) return { ok: false, code: 'NOT_FOUND' }

  const settings = await getEmailSettings()
  if (!settings.outreachRealSendingEnabled && !isLocalSmtpHost(row.smtpHost)) {
    return { ok: false, code: 'OUTREACH_REAL_SENDING_DISABLED' }
  }

  const pass = await decryptField(row.secretEnc)
  const res = await sendViaSmtp(
    {
      id: row.id,
      host: row.smtpHost,
      port: row.smtpPort,
      secure: row.smtpSecure,
      user: row.address,
      pass,
    },
    {
      from: formatMailboxFrom(row),
      to: toAddress,
      subject: 'VanaDash — Test cutie outreach',
      text: `Test de trimitere SMTP pentru cutia ${row.address}.`,
      html: `<p>Test de trimitere SMTP pentru cutia <strong>${row.address}</strong>.</p>`,
    },
  )

  const now = new Date()
  if (res.ok) {
    await db
      .update(outreachMailboxes)
      .set({ status: 'active', lastErrorCode: null, lastTestedAt: now, updatedAt: now })
      .where(eq(outreachMailboxes.id, row.id))
    return { ok: true }
  }

  const nextStatus = res.code === 'SMTP_AUTH_FAILED' || res.code === 'SMTP_UNREACHABLE' ? 'error' : row.status
  await db
    .update(outreachMailboxes)
    .set({ status: nextStatus, lastErrorCode: res.code, lastTestedAt: now, updatedAt: now })
    .where(eq(outreachMailboxes.id, row.id))
  return { ok: false, code: res.code }
}

/**
 * Picks the next eligible active outreach mailbox (round-robin: oldest `lastSentAt` first,
 * with `usedToday < effectiveDailyCap`). Returns null if none has remaining capacity.
 */
export async function pickNextOutreachMailbox(): Promise<{ mailbox: OutreachMailboxRow; pass: string } | null> {
  const [rows, usedMap] = await Promise.all([
    db
      .select()
      .from(outreachMailboxes)
      .where(and(eq(outreachMailboxes.status, 'active'), isNull(outreachMailboxes.deletedAt)))
      .orderBy(sql`${outreachMailboxes.lastSentAt} ASC NULLS FIRST`, asc(outreachMailboxes.createdAt)),
    countUsedTodayByMailbox(),
  ])

  const now = new Date()
  for (const row of rows) {
    const used = usedMap.get(row.id) ?? 0
    if (used < effectiveDailyCap(row, now)) {
      const pass = await decryptField(row.secretEnc)
      return { mailbox: row, pass }
    }
  }
  return null
}

export async function markMailboxSent(id: string): Promise<void> {
  const now = new Date()
  await db
    .update(outreachMailboxes)
    .set({ lastSentAt: now, lastErrorCode: null, updatedAt: now })
    .where(eq(outreachMailboxes.id, id))
}

export async function markMailboxError(id: string, code: SmtpErrorCode): Promise<void> {
  const now = new Date()
  const nextStatus = code === 'SMTP_AUTH_FAILED' || code === 'SMTP_UNREACHABLE' ? 'error' : 'active'
  await db
    .update(outreachMailboxes)
    .set({ status: nextStatus, lastErrorCode: code, updatedAt: now })
    .where(eq(outreachMailboxes.id, id))
}
