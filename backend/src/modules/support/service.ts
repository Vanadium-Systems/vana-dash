import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { supportTicketReplies, supportTickets, users } from '../../shared/db/schema/index.js'
import { config } from '../../shared/config.js'
import { sendEmail } from '../../shared/lib/email.js'
import { notifyPush } from '../../shared/lib/push.js'

// Tichete de suport (PLAN.md C5). Două priviri pe aceleași rânduri: autorul își vede tichetele
// lui (filtrul pe om e aici, lângă interogare), administratorul de platformă le vede pe toate.
// `scope` spune din ce parte se citește, iar un tichet al altcuia cerut de autor nu există.

export type TicketScope = { kind: 'author'; userId: string } | { kind: 'platform' }
type TicketStatus = (typeof supportTickets.$inferSelect)['status']

const ticketColumns = {
  id: supportTickets.id,
  subject: supportTickets.subject,
  description: supportTickets.description,
  status: supportTickets.status,
  page: supportTickets.page,
  createdAt: supportTickets.createdAt,
  lastActivityAt: supportTickets.lastActivityAt,
  unreadByPlatform: supportTickets.unreadByPlatform,
  unreadByAuthor: supportTickets.unreadByAuthor,
  authorId: users.id,
  authorName: users.displayName,
  authorEmail: users.email,
}

function scopeFilter(scope: TicketScope) {
  return scope.kind === 'author'
    ? and(eq(supportTickets.createdByUserId, scope.userId), isNull(supportTickets.deletedAt))
    : isNull(supportTickets.deletedAt)
}

interface TicketRow {
  id: string
  subject: string
  description: string
  status: TicketStatus
  page: string | null
  createdAt: Date
  lastActivityAt: Date
  unreadByPlatform: boolean
  unreadByAuthor: boolean
  authorId: string
  authorName: string | null
  authorEmail: string
}

function toTicket(row: TicketRow, scope: TicketScope) {
  const { unreadByPlatform, unreadByAuthor, authorId, authorName, authorEmail, ...ticket } = row
  return {
    ...ticket,
    unread: scope.kind === 'platform' ? unreadByPlatform : unreadByAuthor,
    author: { id: authorId, name: authorName ?? authorEmail },
  }
}

export async function listTickets(scope: TicketScope, status?: TicketStatus) {
  const unread = scope.kind === 'platform' ? supportTickets.unreadByPlatform : supportTickets.unreadByAuthor
  const rows = await db
    .select(ticketColumns)
    .from(supportTickets)
    .innerJoin(users, eq(users.id, supportTickets.createdByUserId))
    .where(and(scopeFilter(scope), status ? eq(supportTickets.status, status) : undefined))
    .orderBy(desc(unread), desc(supportTickets.lastActivityAt))
  return rows.map((row) => toTicket(row, scope))
}

/** Tichetul cu firul lui. Deschiderea îl marchează citit pentru partea care îl deschide. */
export async function getTicket(scope: TicketScope, id: string) {
  const [row] = await db
    .select(ticketColumns)
    .from(supportTickets)
    .innerJoin(users, eq(users.id, supportTickets.createdByUserId))
    .where(and(eq(supportTickets.id, id), scopeFilter(scope)))
  if (!row) return null

  const replies = await db
    .select({
      id: supportTicketReplies.id,
      body: supportTicketReplies.body,
      isPlatformReply: supportTicketReplies.isPlatformReply,
      createdAt: supportTicketReplies.createdAt,
      authorId: users.id,
      authorName: users.displayName,
      authorEmail: users.email,
    })
    .from(supportTicketReplies)
    .innerJoin(users, eq(users.id, supportTicketReplies.authorUserId))
    .where(and(eq(supportTicketReplies.ticketId, id), isNull(supportTicketReplies.deletedAt)))
    .orderBy(asc(supportTicketReplies.createdAt))

  if (scope.kind === 'platform' ? row.unreadByPlatform : row.unreadByAuthor) {
    await db
      .update(supportTickets)
      .set(scope.kind === 'platform' ? { unreadByPlatform: false } : { unreadByAuthor: false })
      .where(eq(supportTickets.id, id))
  }

  return {
    ...toTicket(row, scope),
    unread: false,
    replies: replies.map(({ authorId, authorName, authorEmail, ...reply }) => ({
      ...reply,
      author: { id: authorId, name: authorName ?? authorEmail },
    })),
  }
}

export async function createTicket(userId: string, input: { subject: string; description: string; page?: string }) {
  const [ticket] = await db
    .insert(supportTickets)
    .values({ createdByUserId: userId, subject: input.subject, description: input.description, page: input.page ?? null })
    .returning({ id: supportTickets.id })
  const created = await getTicket({ kind: 'author', userId }, ticket!.id)
  await notifyPlatform(created!.author.name, created!.id, `Tichet nou: ${input.subject}`, input.description)
  return created!
}

/**
 * Răspuns în fir. Al platformei trece tichetul pe „răspuns” și îl face necitit pentru autor;
 * al autorului îl redeschide (și dacă era închis) și îl face necitit pentru platformă.
 */
export async function addReply(scope: TicketScope, authorUserId: string, id: string, body: string) {
  const [ticket] = await db
    .select({ id: supportTickets.id, subject: supportTickets.subject, createdByUserId: supportTickets.createdByUserId })
    .from(supportTickets)
    .where(and(eq(supportTickets.id, id), scopeFilter(scope)))
  if (!ticket) return null

  const fromPlatform = scope.kind === 'platform'
  await db.transaction(async (tx) => {
    await tx.insert(supportTicketReplies).values({ ticketId: id, authorUserId, body, isPlatformReply: fromPlatform })
    await tx
      .update(supportTickets)
      .set({
        status: fromPlatform ? 'raspuns' : 'deschis',
        ...(fromPlatform ? { unreadByAuthor: true, unreadByPlatform: false } : { unreadByPlatform: true, unreadByAuthor: false }),
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(supportTickets.id, id))
  })

  const fresh = await getTicket(scope, id)
  if (fromPlatform) {
    await notifyAuthor(ticket.createdByUserId, id, `Răspuns la tichet: ${ticket.subject}`, body)
  } else {
    await notifyPlatform(fresh!.author.name, id, `Răspuns la tichet: ${ticket.subject}`, body)
  }
  return fresh
}

export async function setStatus(scope: TicketScope, id: string, status: TicketStatus) {
  const [row] = await db
    .update(supportTickets)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(supportTickets.id, id), scopeFilter(scope)))
    .returning({ id: supportTickets.id })
  return row ? getTicket(scope, id) : null
}

/** Câte tichete așteaptă să fie citite: ale mele și, pentru platformă, din toată lista. */
export async function unreadCounts(userId: string, isPlatformAdmin: boolean) {
  const [row] = await db
    .select({
      mine: sql<number>`count(*) filter (where ${supportTickets.createdByUserId} = ${userId} and ${supportTickets.unreadByAuthor})::int`,
      platform: sql<number>`count(*) filter (where ${supportTickets.unreadByPlatform})::int`,
    })
    .from(supportTickets)
    .where(isNull(supportTickets.deletedAt))
  return { mine: row?.mine ?? 0, platform: isPlatformAdmin ? (row?.platform ?? 0) : null }
}

// ── Notificări ───────────────────────────────────────────────────────────────────────────────
// Push și email, amândouă izolate: un tichet salvat rămâne salvat și dacă Resend e jos.

const excerpt = (text: string) => (text.length > 140 ? `${text.slice(0, 139)}…` : text)

async function notify(recipients: Array<{ id: string; email: string }>, url: string, title: string, body: string, intro: string) {
  if (recipients.length === 0) return
  await notifyPush('suport', { title, body: excerpt(body), url, tag: `suport-${url}` }, recipients.map((r) => r.id))
  for (const recipient of recipients) {
    try {
      await sendEmail({
        to: recipient.email,
        from: config.emailFromNoreply,
        subject: title,
        text: [intro, '', body, '', `Deschide tichetul: ${config.frontendOrigin}${url}`].join('\n'),
      })
    } catch (err) {
      console.error(`[suport] emailul către ${recipient.id} nu a plecat: ${String(err)}`)
    }
  }
}

async function notifyPlatform(authorName: string, ticketId: string, title: string, body: string) {
  const admins = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.isPlatformAdmin, true), eq(users.status, 'active'), isNull(users.deletedAt)))
  await notify(admins, `/platform/support/${ticketId}`, title, body, `${authorName} a scris în Suport:`)
}

async function notifyAuthor(authorUserId: string, ticketId: string, title: string, body: string) {
  const author = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.id, authorUserId), eq(users.status, 'active'), isNull(users.deletedAt)))
  await notify(author, `/support/${ticketId}`, title, body, 'Ai un răspuns de la Vanadium:')
}
