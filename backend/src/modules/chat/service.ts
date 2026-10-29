import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { conversationMembers, conversations, messageAttachments, messages, users } from '../../shared/db/schema/index.js'
import { createdByUserId } from '../../shared/lib/audit.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { userName } from '../../shared/lib/session.js'
import type {
  CreateConversationSchema,
  ListMessagesQuerySchema,
  SendMessageSchema,
  UpdateConversationSchema,
} from './schema.js'
import type { z } from 'zod'
import { tr } from '../../shared/lib/i18n.js'

// Mesaje între oameni (PLAN.md C3). Un singur backend, deci bus-ul de evenimente e în
// memorie (presence.ts) — dacă ajunge vreodată pe două instanțe, trece pe LISTEN/NOTIFY.
//
// Izolarea e pe DB, nu în filtrul de query: orice rând cu `conversation_id` se atinge doar
// după ce `assertMember` a confirmat că omul e în conversație (404, nu 403 — existența ei nu
// se confirmă nimănui din afara ei).

export type ConversationInput = z.infer<typeof CreateConversationSchema>
export type ConversationPatch = z.infer<typeof UpdateConversationSchema>
export type SendMessageInput = z.infer<typeof SendMessageSchema>
export type ListMessagesQuery = z.infer<typeof ListMessagesQuerySchema>

export interface ChatAttachment {
  id: string
  filename: string
  contentType: string
  sizeBytes: number
}

export interface ChatMessage {
  id: string
  conversationId: string
  authorUserId: string
  authorName: string
  body: string
  clientId: string
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
  attachments: ChatAttachment[]
}

export interface ChatMember {
  id: string
  displayName: string | null
  email: string
  lastSeenAt: string | null
}

/** How far each other member has got: the ticks on the viewer's own messages. */
export interface ChatReceipt {
  userId: string
  deliveredUpTo: string | null
  readUpTo: string | null
}

export interface ChatConversationSummary {
  id: string
  kind: 'dm' | 'group'
  name: string | null
  members: ChatMember[]
  lastMessage: { body: string; authorId: string; createdAt: string } | null
  unreadCount: number
  muted: boolean
}

export class ConversationForbiddenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConversationForbiddenError'
  }
}

/** Cerere invalidă (400), nu lipsa accesului (404) — mesaj gol, grup fără membri. */
export class MessageBodyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MessageBodyError'
  }
}

/** E membru, dar operația e rezervată owner-ului grupului / administratorului (403). */
export class GroupPermissionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GroupPermissionError'
  }
}

/** Membru al conversației sau nimic — 404 pentru orice altceva. */
export async function assertMember(conversationId: string, userId: string): Promise<void> {
  const [row] = await db
    .select({ id: conversationMembers.id })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)))
  if (!row) throw new ConversationForbiddenError(tr('errors.chat.conversationNotFound'))
}

export async function isMember(conversationId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: conversationMembers.id })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)))
  return Boolean(row)
}

/** Ids-urile celorlalți membri, fără cei care au conversația mutată. */
export async function memberIds(conversationId: string, excludeUserId?: string): Promise<string[]> {
  const rows = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(eq(conversationMembers.conversationId, conversationId))
  return rows.map((r) => r.userId).filter((id) => id !== excludeUserId)
}

async function attachToMessages(rows: (typeof messages.$inferSelect)[]): Promise<ChatMessage[]> {
  if (rows.length === 0) return []
  const messageIds = rows.map((r) => r.id)
  const [attachmentRows, authorRows] = await Promise.all([
    db
      .select({
        id: messageAttachments.id,
        messageId: messageAttachments.messageId,
        filename: messageAttachments.filename,
        contentType: messageAttachments.contentType,
        sizeBytes: messageAttachments.sizeBytes,
      })
      .from(messageAttachments)
      .where(and(inArray(messageAttachments.messageId, messageIds), isNull(messageAttachments.deletedAt))),
    db
      .select({ id: users.id, displayName: users.displayName, email: users.email })
      .from(users)
      .where(inArray(users.id, [...new Set(rows.map((r) => r.authorUserId))])),
  ])

  const byMessage = new Map<string, ChatAttachment[]>()
  for (const a of attachmentRows) {
    if (!a.messageId) continue
    const list = byMessage.get(a.messageId) ?? []
    list.push({ id: a.id, filename: a.filename, contentType: a.contentType, sizeBytes: a.sizeBytes })
    byMessage.set(a.messageId, list)
  }
  const nameById = new Map(authorRows.map((u) => [u.id, u.displayName ?? u.email]))

  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversationId,
    authorUserId: row.authorUserId,
    authorName: nameById.get(row.authorUserId) ?? '',
    body: row.deletedAt ? '' : row.body,
    clientId: row.clientId,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    attachments: byMessage.get(row.id) ?? [],
  }))
}

export async function listConversations(me: SessionUser): Promise<ChatConversationSummary[]> {
  const memberships = await db
    .select({
      conversationId: conversationMembers.conversationId,
      muted: conversationMembers.muted,
    })
    .from(conversationMembers)
    .where(eq(conversationMembers.userId, me.id))
  if (memberships.length === 0) return []

  const memberRows = await db
    .select({
      conversationId: conversationMembers.conversationId,
      userId: conversationMembers.userId,
      kind: conversations.kind,
      name: conversations.name,
      displayName: users.displayName,
      email: users.email,
      lastSeenAt: users.lastSeenAt,
    })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(inArray(conversationMembers.conversationId, memberships.map((m) => m.conversationId)))

  const summaries = new Map<string, ChatConversationSummary>()
  for (const row of memberRows) {
    const membership = memberships.find((m) => m.conversationId === row.conversationId)!
    const existing = summaries.get(row.conversationId)
    if (existing) {
      existing.members.push({
        id: row.userId,
        displayName: row.displayName,
        email: row.email,
        lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      })
      continue
    }
    summaries.set(row.conversationId, {
      id: row.conversationId,
      kind: row.kind as 'dm' | 'group',
      name: row.name,
      members: [
        {
          id: row.userId,
          displayName: row.displayName,
          email: row.email,
          lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
        },
      ],
      lastMessage: null,
      unreadCount: 0,
      muted: membership.muted,
    })
  }

  const conversationIds = [...summaries.keys()]
  const lastRows = await db
    .select({
      conversationId: messages.conversationId,
      body: messages.body,
      authorId: messages.authorUserId,
      createdAt: messages.createdAt,
      position: sql<number>`row_number() OVER (PARTITION BY ${messages.conversationId} ORDER BY ${messages.createdAt} DESC, ${messages.id} DESC)::int`,
    })
    .from(messages)
    .where(and(inArray(messages.conversationId, conversationIds), isNull(messages.deletedAt)))
  for (const row of lastRows) {
    if (row.position !== 1) continue
    summaries.get(row.conversationId)!.lastMessage = {
      body: row.body,
      authorId: row.authorId,
      createdAt: row.createdAt.toISOString(),
    }
  }

  // Necitite = mesaje ale altora, mai noi decât watermark-ul omului. Fără watermark (membru
  // adăugat acum), pragul e momentul intrării lui în conversație — altfel ar vedea ca
  // necitite toată istoricul unui grup în care tocmai a fost pus.
  const counts = await db
    .select({ conversationId: messages.conversationId, unread: sql<number>`count(*)::int` })
    .from(conversationMembers)
    .innerJoin(
      messages,
      and(
        eq(messages.conversationId, conversationMembers.conversationId),
        ne(messages.authorUserId, conversationMembers.userId),
        isNull(messages.deletedAt),
        sql`${messages.createdAt} > coalesce(
              (SELECT m.created_at FROM messages m WHERE m.id = ${conversationMembers.lastReadMessageId}),
              ${conversationMembers.createdAt})`,
      ),
    )
    .where(eq(conversationMembers.userId, me.id))
    .groupBy(messages.conversationId)

  const unreadById = new Map(counts.map((c) => [c.conversationId, c.unread]))
  for (const [id, summary] of summaries) {
    summary.unreadCount = summary.muted ? 0 : (unreadById.get(id) ?? 0)
  }

  return [...summaries.values()].sort((a, b) => lastActivity(b) - lastActivity(a))
}

function lastActivity(summary: ChatConversationSummary): number {
  return summary.lastMessage ? new Date(summary.lastMessage.createdAt).getTime() : 0
}

/** Ids-urile oamenilor cu care omul dat are o conversație — destinația evenimentelor de prezență. */
export async function conversationPartnerIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ conversationId: conversationMembers.conversationId })
    .from(conversationMembers)
    .where(eq(conversationMembers.userId, userId))
  if (rows.length === 0) return []
  const partners = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(inArray(conversationMembers.conversationId, rows.map((r) => r.conversationId)))
  return [...new Set(partners.map((p) => p.userId))].filter((id) => id !== userId)
}

/** Conversația de DM dintre doi oameni, creată dacă nu există. */
export async function openDm(me: SessionUser, otherUserId: string): Promise<string> {
  if (otherUserId === me.id) throw new MessageBodyError(tr('errors.chat.cannotWriteToSelf'))

  const [other] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, otherUserId), isNull(users.deletedAt)))
  if (!other) throw new ConversationForbiddenError(tr('errors.chat.colleagueNotFound'))

  const dmKey = [me.id, otherUserId].sort().join(':')
  const [existing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.kind, 'dm'), eq(conversations.dmKey, dmKey)))
  if (existing) return existing.id

  const [row] = await db
    .insert(conversations)
    .values({ kind: 'dm', dmKey, createdByUserId: me.id, ...createdByUserId() })
    .returning({ id: conversations.id })
  await db.insert(conversationMembers).values([
    { conversationId: row!.id, userId: me.id, role: 'owner' },
    { conversationId: row!.id, userId: otherUserId, role: 'member' },
  ])
  return row!.id
}

export async function createGroup(me: SessionUser, input: { name: string; memberIds: string[] }): Promise<string> {
  const others = [...new Set(input.memberIds)].filter((id) => id !== me.id)
  if (others.length === 0) throw new MessageBodyError(tr('errors.chat.groupNeedsMember'))

  const valid = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, others), isNull(users.deletedAt)))
  if (valid.length !== others.length) throw new MessageBodyError(tr('errors.chat.colleagueNotFound'))

  const [row] = await db
    .insert(conversations)
    .values({ kind: 'group', name: input.name, createdByUserId: me.id, ...createdByUserId() })
    .returning({ id: conversations.id })
  await db.insert(conversationMembers).values([
    { conversationId: row!.id, userId: me.id, role: 'owner' },
    ...valid.map((u) => ({ conversationId: row!.id, userId: u.id, role: 'member' as const })),
  ])
  return row!.id
}

/** Cine poate redenumi un grup sau scoate membri: owner-ul lui, sau cineva cu `echipa.administrare`. */
function canManageConversation(me: SessionUser, ownerId: string): boolean {
  return me.id === ownerId || me.features.includes('echipa.administrare')
}

export async function updateConversation(me: SessionUser, conversationId: string, patch: ConversationPatch): Promise<void> {
  await assertMember(conversationId, me.id)

  // Mutarea pe „nu mai notifica" e al omului, nu al grupului — merge și la DM.
  if (patch.muted !== undefined) {
    await db
      .update(conversationMembers)
      .set({ muted: patch.muted })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, me.id)))
    return
  }

  const [conversation] = await db
    .select({ kind: conversations.kind, createdByUserId: conversations.createdByUserId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  if (!conversation) throw new ConversationForbiddenError(tr('errors.chat.conversationNotFound'))
  if (conversation.kind === 'dm') {
    // Un DM nu are nume și nici membri noi: relația dintre doi oameni se creează doar în openDm.
    throw new ConversationForbiddenError(tr('errors.chat.dmHasNoNameOrMembers'))
  }
  if (!canManageConversation(me, conversation.createdByUserId)) {
    throw new GroupPermissionError(tr('errors.chat.ownerOrAdminOnly'))
  }

  if (patch.name !== undefined) {
    await db.update(conversations).set({ name: patch.name, updatedAt: new Date() }).where(eq(conversations.id, conversationId))
  }
  if (patch.addMemberIds?.length) {
    const added = [...new Set(patch.addMemberIds)].filter((id) => id !== me.id)
    if (added.length > 0) {
      const valid = await db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, added), isNull(users.deletedAt)))
      await db
        .insert(conversationMembers)
        .values(valid.map((u) => ({ conversationId, userId: u.id })))
        .onConflictDoNothing()
    }
  }
  if (patch.removeMemberIds?.length) {
    // Owner-ul nu poate fi scos, iar nimeni nu se scoate pe sine — altfel grupul rămâne fără
    // nimeni care să-l administreze.
    const removable = [...new Set(patch.removeMemberIds)].filter((id) => id !== me.id)
    if (removable.length > 0) {
      await db
        .delete(conversationMembers)
        .where(and(eq(conversationMembers.conversationId, conversationId), inArray(conversationMembers.userId, removable)))
    }
  }
}

export async function listMessages(
  me: SessionUser,
  conversationId: string,
  query: ListMessagesQuery,
): Promise<{ messages: ChatMessage[]; hasMore: boolean; receipts: ChatReceipt[] }> {
  await assertMember(conversationId, me.id)
  const cursor = query.before
    ? (await db.select({ createdAt: messages.createdAt, id: messages.id }).from(messages).where(eq(messages.id, query.before)))[0]
    : undefined

  const filters = [eq(messages.conversationId, conversationId)]
  if (cursor) {
    filters.push(
      or(lt(messages.createdAt, cursor.createdAt), and(eq(messages.createdAt, cursor.createdAt), lt(messages.id, cursor.id)))!,
    )
  }
  const rows = await db
    .select()
    .from(messages)
    .where(and(...filters))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(query.limit + 1)

  const hasMore = rows.length > query.limit
  return { messages: await attachToMessages(rows.slice(0, query.limit).reverse()), hasMore, receipts: await listReceipts(conversationId, me.id) }
}

async function listReceipts(conversationId: string, viewerId: string): Promise<ChatReceipt[]> {
  const rows = await db
    .select({
      userId: conversationMembers.userId,
      deliveredUpTo: conversationMembers.deliveredUpTo,
      readUpTo: sql<Date | null>`(SELECT m.created_at FROM messages m WHERE m.id = ${conversationMembers.lastReadMessageId})`,
    })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), ne(conversationMembers.userId, viewerId)))
  return rows.map((r) => ({
    userId: r.userId,
    deliveredUpTo: r.deliveredUpTo?.toISOString() ?? null,
    readUpTo: r.readUpTo ? new Date(r.readUpTo).toISOString() : null,
  }))
}

/**
 * The person's app has received everything up to `upTo` (in one conversation, or all of theirs).
 * Returns the conversations where that covered a message from someone else not yet marked, so
 * the authors' ticks can move; a reload with nothing new returns nothing and publishes nothing.
 */
export async function markDelivered(userId: string, upTo: Date, conversationId?: string): Promise<string[]> {
  const rows = await db
    .update(conversationMembers)
    .set({ deliveredUpTo: upTo })
    .where(
      and(
        eq(conversationMembers.userId, userId),
        conversationId ? eq(conversationMembers.conversationId, conversationId) : undefined,
        sql`EXISTS (
          SELECT 1 FROM ${messages} m
          WHERE m.conversation_id = ${conversationMembers.conversationId}
            AND m.author_user_id <> ${userId}
            AND m.created_at <= ${upTo.toISOString()}::timestamptz
            AND m.created_at > COALESCE(${conversationMembers.deliveredUpTo}, 'epoch'::timestamptz)
        )`,
      ),
    )
    .returning({ conversationId: conversationMembers.conversationId })
  return rows.map((r) => r.conversationId)
}

export async function sendMessage(me: SessionUser, conversationId: string, input: SendMessageInput): Promise<ChatMessage> {
  await assertMember(conversationId, me.id)
  const trimmed = input.body.trim()
  if (!trimmed && input.attachmentIds.length === 0) throw new MessageBodyError(tr('errors.chat.emptyMessage'))

  // Dedupe pe clientId (mesajul optimist din FE, retrimitere pe conexiune lentă): a doua
  // încercare întoarce același mesaj, nu o copie. Atașamentele încă neatinse se leagă de
  // mesajul existent — altfel ar dispărea din composer la reluarea conexiunii.
  const [existing] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.clientId, input.clientId)))
  if (existing) {
    if (trimmed && !existing.body) await db.update(messages).set({ body: trimmed }).where(eq(messages.id, existing.id))
    await attachAttachments(existing.id, conversationId, input.attachmentIds, me.id)
    const [row] = await db.select().from(messages).where(eq(messages.id, existing.id))
    return (await attachToMessages([row!]))[0]!
  }

  const [row] = await db
    .insert(messages)
    .values({ conversationId, authorUserId: me.id, body: trimmed, clientId: input.clientId })
    .returning()

  await attachAttachments(row!.id, conversationId, input.attachmentIds, me.id)
  // Autorul și-a citit mesajul: watermark-ul lui avansează, deci nu îl numără ca necitit.
  await db
    .update(conversationMembers)
    .set({ lastReadMessageId: row!.id })
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, me.id)))

  return (await attachToMessages([row!]))[0]!
}

/**
 * Leagă de mesaj atașamentele încărcate de același om (message_id null). Un id cerut pe altă
 * conversație, sau încărcat de altcineva, nu se leagă — și rămâne de curățat de job în 24h.
 */
async function attachAttachments(
  messageId: string,
  conversationId: string,
  attachmentIds: string[],
  userId: string,
): Promise<number> {
  if (attachmentIds.length === 0) return 0
  const [message] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)))
  if (!message) return 0
  const updated = await db
    .update(messageAttachments)
    .set({ messageId })
    .where(
      and(
        inArray(messageAttachments.id, attachmentIds),
        isNull(messageAttachments.messageId),
        eq(messageAttachments.uploadedByUserId, userId),
      ),
    )
    .returning({ id: messageAttachments.id })
  return updated.length
}

export async function editMessage(me: SessionUser, messageId: string, body: string): Promise<ChatMessage> {
  const [row] = await db
    .update(messages)
    .set({ body: body.trim(), editedAt: new Date() })
    .where(and(eq(messages.id, messageId), eq(messages.authorUserId, me.id), isNull(messages.deletedAt)))
    .returning()
  if (!row) throw new ConversationForbiddenError(tr('errors.chat.messageNotFound'))
  await assertMember(row.conversationId, me.id)
  return (await attachToMessages([row]))[0]!
}

export async function deleteMessage(me: SessionUser, messageId: string): Promise<{ id: string; conversationId: string }> {
  const [row] = await db
    .update(messages)
    .set({ deletedAt: new Date() })
    .where(and(eq(messages.id, messageId), eq(messages.authorUserId, me.id), isNull(messages.deletedAt)))
    .returning({ id: messages.id, conversationId: messages.conversationId })
  if (!row) throw new ConversationForbiddenError(tr('errors.chat.messageNotFound'))
  return row
}

export async function markRead(me: SessionUser, conversationId: string, messageId: string): Promise<void> {
  await assertMember(conversationId, me.id)
  const [message] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)))
  if (!message) throw new ConversationForbiddenError(tr('errors.chat.messageNotFound'))
  await db
    .update(conversationMembers)
    .set({ lastReadMessageId: messageId })
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, me.id)))
}

/**
 * Pushul unui mesaj: cine îl primește și cu ce titlu. La DM titlul e autorul (din perspectiva
 * destinatarului, celălalt om); la grup, numele grupului, cu autorul în corp. Preferința
 * `notificationPrefs.chat` se respectă per om: „none" tace, „dm" primește doar din DM-uri.
 */
export async function pushTarget(
  conversationId: string,
  authorId: string,
): Promise<{ kind: 'dm' | 'group'; title: string; byline: string; recipients: string[] } | null> {
  const [conversation] = await db
    .select({ kind: conversations.kind, name: conversations.name })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
  if (!conversation) return null
  const kind = conversation.kind as 'dm' | 'group'

  const [members, author] = await Promise.all([
    db
      .select({ userId: conversationMembers.userId, muted: conversationMembers.muted, prefs: users.notificationPrefs })
      .from(conversationMembers)
      .innerJoin(users, eq(users.id, conversationMembers.userId))
      .where(and(eq(conversationMembers.conversationId, conversationId), ne(conversationMembers.userId, authorId))),
    db
      .select({ displayName: users.displayName, email: users.email })
      .from(users)
      .where(eq(users.id, authorId)),
  ])
  const authorName = author[0] ? userName(author[0]) : tr('push.chat.aColleague')

  return {
    kind,
    title: kind === 'group' ? (conversation.name ?? 'Grup') : authorName,
    byline: authorName,
    recipients: members
      .filter((member) => {
        if (member.muted) return false
        const mode = member.prefs?.chat ?? 'all'
        if (mode === 'none') return false
        return !(mode === 'dm' && kind !== 'dm')
      })
      .map((member) => member.userId),
  }
}
