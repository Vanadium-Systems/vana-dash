import { and, eq, gte, isNull, ne, notInArray, sql, type SQL } from 'drizzle-orm'
import type { FastifyReply } from 'fastify'
import { db } from '../../shared/db/client.js'
import { emailSends, emailUserSettings } from '../../shared/db/schema/index.js'
import { MailboxForbidden } from './mailboxes.js'
import { getEmailSettings, resolveFromAddress } from './settings-service.js'
import { getSuppressedEmails } from './unsubscribe-service.js'

// The one gate every send passes, right before it reaches Resend: compose, reply, forward,
// draft, bulk, sequences and the assistant. Before this, a 1:1 send skipped both checks
// that bulk already had (unsubscribes and the outreach cap).

export class EmailSuppressedError extends Error {
  readonly code = 'RECIPIENT_UNSUBSCRIBED'
  constructor(readonly address: string) {
    super(`recipient_unsubscribed: ${address}`)
  }
}

export class OutreachCapError extends Error {
  readonly code = 'OUTREACH_CAP_REACHED'
  constructor(readonly limit: number) {
    super(`outreach_cap_reached: ${limit}`)
  }
}

export const OUTREACH_IDENTITY = 'outreach'

function startOfUtcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/**
 * Today's sends from the outreach address. A scheduled row counts as soon as it is written, so
 * two quick sends cannot both pass the last free slot; the dispatcher re-checks without its own row.
 */
export async function countOutreachSendsToday(opts: { userId?: string; excludeSendId?: string } = {}): Promise<number> {
  const conditions: SQL[] = [
    isNull(emailSends.deletedAt),
    eq(emailSends.fromAddress, await resolveFromAddress(OUTREACH_IDENTITY)),
    gte(emailSends.createdAt, startOfUtcDay()),
    notInArray(emailSends.status, ['cancelled']),
  ]
  if (opts.userId) conditions.push(eq(emailSends.sentByUserId, opts.userId))
  if (opts.excludeSendId) conditions.push(ne(emailSends.id, opts.excludeSendId))
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(emailSends)
    .where(and(...conditions))
  return row?.count ?? 0
}

export async function getUserOutreachCap(userId: string): Promise<number | null> {
  const [row] = await db
    .select({ cap: emailUserSettings.outreachDailyCap })
    .from(emailUserSettings)
    .where(and(eq(emailUserSettings.userId, userId), isNull(emailUserSettings.deletedAt)))
  return row?.cap ?? null
}

export async function assertCanDeliver(input: {
  identityKey: string | null
  recipients: string[]
  senderUserId: string | null
  /** The scheduled row being dispatched, already counted in today's total. */
  excludeSendId?: string
}): Promise<void> {
  const suppressed = await getSuppressedEmails(input.recipients)
  const blocked = input.recipients.find((r) => suppressed.has(r.trim().toLowerCase()))
  if (blocked) throw new EmailSuppressedError(blocked)

  if (input.identityKey !== OUTREACH_IDENTITY) return

  const { outreachDailyCap: companyCap } = await getEmailSettings()
  const companyUsed = await countOutreachSendsToday({ excludeSendId: input.excludeSendId })
  if (companyUsed + input.recipients.length > companyCap) throw new OutreachCapError(companyCap)

  if (!input.senderUserId) return
  const userCap = await getUserOutreachCap(input.senderUserId)
  if (userCap === null) return
  const limit = Math.min(userCap, companyCap)
  const userUsed = await countOutreachSendsToday({ userId: input.senderUserId, excludeSendId: input.excludeSendId })
  if (userUsed + input.recipients.length > limit) throw new OutreachCapError(limit)
}

/** The HTTP answer for a refused delivery, or null when `err` is something else. */
export function deliveryErrorResponse(err: unknown): { status: number; body: { success: false; error: Record<string, unknown> } } | null {
  if (err instanceof EmailSuppressedError) {
    return { status: 409, body: { success: false, error: { code: err.code, address: err.address } } }
  }
  if (err instanceof OutreachCapError) {
    return { status: 429, body: { success: false, error: { code: err.code, limit: err.limit } } }
  }
  return null
}

/** The error answer shared by the four send routes (new, reply, forward, draft). */
export function sendErrorReply(reply: FastifyReply, err: unknown) {
  const refused = deliveryErrorResponse(err)
  if (refused) return reply.code(refused.status).send(refused.body)
  // The reply leaves from the thread's mailbox: if that is not the person's, it is a mailbox refusal (403).
  if (err instanceof MailboxForbidden) {
    return reply.code(403).send({ success: false, error: { code: err.code, feature: err.fromKey } })
  }
  // Double reply: 409 with who replied meanwhile, so the frontend can show "Ion replied 3 min ago".
  if (err instanceof Error && (err as { code?: string }).code === 'THREAD_REPLIED_MEANWHILE') {
    const e = err as unknown as { by: string | null; at: Date }
    return reply.code(409).send({ success: false, error: { code: 'THREAD_REPLIED_MEANWHILE', by: e.by, at: e.at } })
  }
  return reply.code(400).send({ success: false, error: String(err) })
}
