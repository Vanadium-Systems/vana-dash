import { and, eq, gte, isNull, ne, notInArray, or, sql, type SQL } from 'drizzle-orm'
import type { FastifyReply } from 'fastify'
import { db } from '../../shared/db/client.js'
import { emailSends, emailUserSettings } from '../../shared/db/schema/index.js'
import { fail, HttpError } from '../../shared/lib/http-error.js'
import { MailboxForbidden } from './mailboxes.js'
import { getOutreachMailboxAggregateCap, hasConfiguredOutreachMailboxes } from './outreach-mailboxes-service.js'
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
  const outreachFrom = await resolveFromAddress(OUTREACH_IDENTITY)
  const conditions: SQL[] = [
    isNull(emailSends.deletedAt),
    or(sql`${emailSends.outreachMailboxId} IS NOT NULL`, eq(emailSends.fromAddress, outreachFrom))!,
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

  let companyCap: number
  if (await hasConfiguredOutreachMailboxes()) {
    const agg = await getOutreachMailboxAggregateCap()
    companyCap = agg.cap
    if (agg.remaining < input.recipients.length) throw new OutreachCapError(companyCap)
  } else {
    companyCap = (await getEmailSettings()).outreachDailyCap
    const companyUsed = await countOutreachSendsToday({ excludeSendId: input.excludeSendId })
    if (companyUsed + input.recipients.length > companyCap) throw new OutreachCapError(companyCap)
  }

  if (!input.senderUserId) return
  const userCap = await getUserOutreachCap(input.senderUserId)
  if (userCap === null) return
  const limit = Math.min(userCap, companyCap)
  const userUsed = await countOutreachSendsToday({ userId: input.senderUserId, excludeSendId: input.excludeSendId })
  if (userUsed + input.recipients.length > limit) throw new OutreachCapError(limit)
}

/** The refusal for a blocked delivery as code + params, or null when `err` is something else. */
export function deliveryRefusal(err: unknown): { status: number; code: string; params: Record<string, string | number> } | null {
  if (err instanceof EmailSuppressedError) return { status: 409, code: err.code, params: { address: err.address } }
  if (err instanceof OutreachCapError) return { status: 429, code: err.code, params: { limit: err.limit } }
  return null
}

/** The error answer shared by the four send routes (new, reply, forward, draft). */
export function sendErrorReply(reply: FastifyReply, err: unknown) {
  const refused = deliveryRefusal(err)
  // The params are also the details the compose form reads (`address`, `limit`).
  if (refused) return fail(reply, refused.status, refused.code, { params: refused.params, details: refused.params })
  // The reply leaves from the thread's mailbox: if that is not the person's, it is a mailbox refusal (403).
  if (err instanceof MailboxForbidden) {
    return fail(reply, 403, err.code, { message: err.message, details: { feature: err.fromKey } })
  }
  // Double reply: 409 with who replied meanwhile, so the frontend can show "Ion replied 3 min ago".
  if (err instanceof Error && (err as { code?: string }).code === 'THREAD_REPLIED_MEANWHILE') {
    const e = err as unknown as { by: string | null; at: Date }
    return fail(reply, 409, 'THREAD_REPLIED_MEANWHILE', { details: { by: e.by, at: e.at } })
  }
  if (err instanceof HttpError) throw err
  reply.log.warn({ err }, 'email send refused')
  return fail(reply, 400, 'MAIL_SEND_FAILED')
}
