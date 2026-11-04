import { and, asc, desc, eq, gt, gte, inArray, isNull, like, lt, ne, notLike, or, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import {
  conversationMembers,
  conversations,
  messageAttachments,
  messageReactions,
  messageRefs,
  messages,
  roles,
  users,
} from '../../shared/db/schema/index.js'
import { createdByUserId } from '../../shared/lib/audit.js'
import { refAdapter, type RefFile, type RefSnapshot, type RefType } from '../../shared/lib/entity-refs.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { effectiveFeatures, userName } from '../../shared/lib/session.js'
import { foldDiacritics, foldedIlike } from '../../shared/lib/text.js'
import type {
  CreateConversationSchema,
  ListMessagesQuerySchema,
  MediaQuerySchema,
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

export interface ChatReplyPreview {
  id: string
  authorName: string
  body: string
  hasAttachment: boolean
  deleted: boolean
}

export interface ChatReaction {
  emoji: string
  userIds: string[]
}

export interface ChatMessageRef {
  id: string
  type: RefType
  /** Only when the reader can open the object. */
  refId: string | null
  state: 'live' | 'snapshot' | 'denied' | 'gone'
  canOpen: boolean
  card: RefSnapshot
  /** On a denied company object: who can give access (the page is granted by role, not by the sender). */
  grantors?: { userId: string; name: string }[]
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
  replyTo: ChatReplyPreview | null
  reactions: ChatReaction[]
  refs: ChatMessageRef[]
}

const REPLY_PREVIEW_MAX = 200

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
  lastMessage: {
    body: string
    authorId: string
    createdAt: string
    attachmentKind: 'image' | 'file' | null
    refType: RefType | null
  } | null
  unreadCount: number
  muted: boolean
  /** Can rename the group and add or remove its members (its creator, or a team admin). */
  canManage: boolean
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

/** 400 with a code the client can branch on (`{ error: { code } }`). */
export class ChatRequestError extends Error {
  constructor(public readonly code: 'REPLY_NOT_IN_CONVERSATION') {
    super(code)
    this.name = 'ChatRequestError'
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

async function attachToMessages(rows: (typeof messages.$inferSelect)[], reader: SessionUser): Promise<ChatMessage[]> {
  if (rows.length === 0) return []
  const messageIds = rows.map((r) => r.id)
  const replyIds = [...new Set(rows.map((r) => r.replyToId).filter((id): id is string => Boolean(id)))]
  const [attachmentRows, replyRows, reactionRows, refs] = await Promise.all([
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
    replyIds.length === 0
      ? Promise.resolve([])
      : db
          .select({
            id: messages.id,
            authorUserId: messages.authorUserId,
            body: messages.body,
            deletedAt: messages.deletedAt,
            hasAttachment: sql<boolean>`EXISTS (SELECT 1 FROM ${messageAttachments} a WHERE a.message_id = ${messages.id} AND a.deleted_at IS NULL)`,
          })
          .from(messages)
          .where(inArray(messages.id, replyIds)),
    db
      .select({ messageId: messageReactions.messageId, userId: messageReactions.userId, emoji: messageReactions.emoji })
      .from(messageReactions)
      .where(and(inArray(messageReactions.messageId, messageIds), isNull(messageReactions.deletedAt)))
      .orderBy(asc(messageReactions.createdAt), asc(messageReactions.id)),
    resolveRefs(messageIds, reader),
  ])
  const authorIds = [...new Set([...rows.map((r) => r.authorUserId), ...replyRows.map((r) => r.authorUserId)])]
  const authorRows = await db
    .select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(users)
    .where(inArray(users.id, authorIds))

  const byMessage = new Map<string, ChatAttachment[]>()
  for (const a of attachmentRows) {
    if (!a.messageId) continue
    const list = byMessage.get(a.messageId) ?? []
    list.push({ id: a.id, filename: a.filename, contentType: a.contentType, sizeBytes: a.sizeBytes })
    byMessage.set(a.messageId, list)
  }
  const nameById = new Map(authorRows.map((u) => [u.id, u.displayName ?? u.email]))
  const replyById = new Map<string, ChatReplyPreview>(
    replyRows.map((r) => [
      r.id,
      {
        id: r.id,
        authorName: nameById.get(r.authorUserId) ?? '',
        body: r.deletedAt ? '' : r.body.slice(0, REPLY_PREVIEW_MAX),
        hasAttachment: !r.deletedAt && Boolean(r.hasAttachment),
        deleted: Boolean(r.deletedAt),
      },
    ]),
  )
  const reactionsByMessage = groupReactions(reactionRows)

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
    replyTo: row.replyToId ? (replyById.get(row.replyToId) ?? null) : null,
    reactions: reactionsByMessage.get(row.id) ?? [],
    refs: refs.get(row.id) ?? [],
  }))
}

/** Ordered by each emoji's first reaction, as the rows come in. */
function groupReactions(rows: { messageId: string; userId: string; emoji: string }[]): Map<string, ChatReaction[]> {
  const out = new Map<string, ChatReaction[]>()
  for (const row of rows) {
    const list = out.get(row.messageId) ?? []
    const existing = list.find((r) => r.emoji === row.emoji)
    if (existing) existing.userIds.push(row.userId)
    else list.push({ emoji: row.emoji, userIds: [row.userId] })
    out.set(row.messageId, list)
  }
  return out
}

/** The cards on a page of messages, one resolve call per type (no query per message). */
async function resolveRefs(messageIds: string[], reader: SessionUser): Promise<Map<string, ChatMessageRef[]>> {
  const rows = await db
    .select({
      id: messageRefs.id,
      messageId: messageRefs.messageId,
      refType: messageRefs.refType,
      refId: messageRefs.refId,
      snapshot: messageRefs.snapshot,
    })
    .from(messageRefs)
    .where(and(inArray(messageRefs.messageId, messageIds), isNull(messageRefs.deletedAt)))
    .orderBy(asc(messageRefs.position))
  const out = new Map<string, ChatMessageRef[]>()
  if (rows.length === 0) return out

  const byType = new Map<RefType, string[]>()
  for (const row of rows) byType.set(row.refType, [...(byType.get(row.refType) ?? []), row.refId])
  const resolved = new Map<RefType, Awaited<ReturnType<NonNullable<ReturnType<typeof refAdapter>>['resolve']>>>()
  for (const [type, ids] of byType) {
    const adapter = refAdapter(type)
    if (adapter) resolved.set(type, await adapter.resolve([...new Set(ids)], reader))
  }

  let grantors: { userId: string; name: string }[] | undefined
  for (const row of rows) {
    const adapter = refAdapter(row.refType)
    const result = resolved.get(row.refType)?.get(row.refId)
    const snapshot = row.snapshot as RefSnapshot
    let ref: ChatMessageRef
    if (adapter?.kind === 'firm' && result?.gone) {
      ref = { id: row.id, type: row.refType, refId: null, state: 'gone', canOpen: false, card: snapshot }
    } else if (adapter?.kind === 'firm' && result?.canOpen) {
      ref = { id: row.id, type: row.refType, refId: row.refId, state: 'live', canOpen: true, card: result.live ?? snapshot }
    } else if (adapter?.kind === 'firm') {
      grantors ??= await accessGrantors(reader)
      ref = { id: row.id, type: row.refType, refId: null, state: 'denied', canOpen: false, card: { title: snapshot.title }, grantors }
    } else {
      const canOpen = Boolean(result?.canOpen)
      // The folder id only builds the link to the original; whoever cannot open it does not get it.
      const card: RefSnapshot = { ...snapshot }
      if (!canOpen) delete card.folderId
      ref = { id: row.id, type: row.refType, refId: canOpen ? row.refId : null, state: 'snapshot', canOpen, card }
    }
    out.set(row.messageId, [...(out.get(row.messageId) ?? []), ref])
  }
  return out
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
      createdByUserId: conversations.createdByUserId,
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
      canManage: row.kind === 'group' && canManageConversation(me, row.createdByUserId),
    })
  }

  const conversationIds = [...summaries.keys()]
  const lastRows = await db
    .select({
      id: messages.id,
      conversationId: messages.conversationId,
      body: messages.body,
      authorId: messages.authorUserId,
      createdAt: messages.createdAt,
      position: sql<number>`row_number() OVER (PARTITION BY ${messages.conversationId} ORDER BY ${messages.createdAt} DESC, ${messages.id} DESC)::int`,
    })
    .from(messages)
    .where(and(inArray(messages.conversationId, conversationIds), isNull(messages.deletedAt)))
  const lastMessages = lastRows.filter((row) => row.position === 1)
  const lastIds = lastMessages.map((row) => row.id)
  const [lastAttachments, lastRefs] = lastIds.length
    ? await Promise.all([
        db
          .select({ messageId: messageAttachments.messageId, contentType: messageAttachments.contentType })
          .from(messageAttachments)
          .where(and(inArray(messageAttachments.messageId, lastIds), isNull(messageAttachments.deletedAt)))
          .orderBy(asc(messageAttachments.createdAt)),
        db
          .select({ messageId: messageRefs.messageId, refType: messageRefs.refType })
          .from(messageRefs)
          .where(and(inArray(messageRefs.messageId, lastIds), isNull(messageRefs.deletedAt)))
          .orderBy(asc(messageRefs.position)),
      ])
    : [[], []]
  for (const row of lastMessages) {
    const attachment = lastAttachments.find((a) => a.messageId === row.id)
    summaries.get(row.conversationId)!.lastMessage = {
      body: row.body,
      authorId: row.authorId,
      createdAt: row.createdAt.toISOString(),
      attachmentKind: attachment ? (attachment.contentType.startsWith('image/') ? 'image' : 'file') : null,
      refType: lastRefs.find((r) => r.messageId === row.id)?.refType ?? null,
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

const AROUND_HALF = 25

export interface MessagePage {
  messages: ChatMessage[]
  hasMore: boolean
  hasNewer: boolean
  receipts: ChatReceipt[]
  /** The reader's watermark before this load marks anything read: where the "New" line goes. */
  lastReadMessageId: string | null
}

export async function listMessages(me: SessionUser, conversationId: string, query: ListMessagesQuery): Promise<MessagePage> {
  await assertMember(conversationId, me.id)
  const inConversation = eq(messages.conversationId, conversationId)
  const olderThan = (c: Cursor) =>
    or(lt(messages.createdAt, c.createdAt), and(eq(messages.createdAt, c.createdAt), lt(messages.id, c.id)))!
  const newerThan = (c: Cursor) =>
    or(gt(messages.createdAt, c.createdAt), and(eq(messages.createdAt, c.createdAt), gt(messages.id, c.id)))!
  const atOrNewer = (c: Cursor) =>
    or(gt(messages.createdAt, c.createdAt), and(eq(messages.createdAt, c.createdAt), gte(messages.id, c.id)))!
  const older = (filter: ReturnType<typeof olderThan> | undefined, limit: number) =>
    db.select().from(messages).where(and(inConversation, filter)).orderBy(desc(messages.createdAt), desc(messages.id)).limit(limit + 1)
  const newer = (filter: ReturnType<typeof newerThan>, limit: number) =>
    db.select().from(messages).where(and(inConversation, filter)).orderBy(asc(messages.createdAt), asc(messages.id)).limit(limit + 1)

  let rows: (typeof messages.$inferSelect)[]
  let hasMore: boolean
  let hasNewer: boolean
  const anchor = query.around
    ? await cursorFor(conversationId, query.around)
    : query.aroundDate
      ? await firstAtOrAfter(conversationId, new Date(query.aroundDate))
      : undefined

  if (anchor) {
    const [before, from] = await Promise.all([older(olderThan(anchor), AROUND_HALF), newer(atOrNewer(anchor), AROUND_HALF)])
    hasMore = before.length > AROUND_HALF
    hasNewer = from.length > AROUND_HALF
    rows = [...before.slice(0, AROUND_HALF).reverse(), ...from.slice(0, AROUND_HALF)]
  } else if (query.after) {
    const cursor = await cursorFor(conversationId, query.after)
    const page = await newer(newerThan(cursor), query.limit)
    hasNewer = page.length > query.limit
    hasMore = true
    rows = page.slice(0, query.limit)
  } else {
    // `aroundDate` past the last message lands here too: the latest page.
    const cursor = query.before ? await cursorFor(conversationId, query.before) : undefined
    const page = await older(cursor ? olderThan(cursor) : undefined, query.limit)
    hasMore = page.length > query.limit
    hasNewer = Boolean(cursor)
    rows = page.slice(0, query.limit).reverse()
  }

  const [membership] = await db
    .select({ lastReadMessageId: conversationMembers.lastReadMessageId })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, me.id)))
  return {
    messages: await attachToMessages(rows, me),
    hasMore,
    hasNewer,
    receipts: await listReceipts(conversationId, me.id),
    lastReadMessageId: membership?.lastReadMessageId ?? null,
  }
}

type Cursor = { createdAt: Date; id: string }

async function cursorFor(conversationId: string, messageId: string): Promise<Cursor> {
  const [row] = await db
    .select({ createdAt: messages.createdAt, id: messages.id })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)))
  if (!row) throw new ConversationForbiddenError(tr('errors.chat.messageNotFound'))
  return row
}

async function firstAtOrAfter(conversationId: string, at: Date): Promise<Cursor | undefined> {
  const [row] = await db
    .select({ createdAt: messages.createdAt, id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), gte(messages.createdAt, at)))
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .limit(1)
  return row
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

/**
 * What the route needs to copy before the message exists: archive files become chat
 * attachments, uploaded by the route (attachments.ts) and linked here like any other.
 */
export interface PreparedRefs {
  rows: { type: RefType; refId: string; card: RefSnapshot; file?: RefFile }[]
}

/** The card the sender would share, for the composer's chip; 404 when they cannot see it. */
export async function previewRef(me: SessionUser, type: RefType, refId: string): Promise<RefSnapshot> {
  const adapter = refAdapter(type)
  const result = adapter ? await adapter.snapshot(refId, me, { preview: true }) : null
  if (!result) throw new ConversationForbiddenError(tr('errors.chat.refNotFound'))
  return result.card
}

/** Checks every shared object with the sender. A missing or hidden one stops the send (404). */
export async function prepareRefs(me: SessionUser, refs: SendMessageInput['refs']): Promise<PreparedRefs> {
  const rows: PreparedRefs['rows'] = []
  for (const ref of refs) {
    const adapter = refAdapter(ref.type)
    const result = adapter ? await adapter.snapshot(ref.id, me, { quote: ref.quote }) : null
    if (!result) throw new ConversationForbiddenError(tr('errors.chat.refNotFound'))
    rows.push({ type: ref.type, refId: ref.id, card: result.card, file: result.file })
  }
  return { rows }
}

export async function sendMessage(
  me: SessionUser,
  conversationId: string,
  input: SendMessageInput,
  prepared: PreparedRefs = { rows: [] },
  copiedAttachmentIds: (string | undefined)[] = [],
): Promise<ChatMessage> {
  await assertMember(conversationId, me.id)
  const trimmed = input.body.trim()
  if (!trimmed && input.attachmentIds.length === 0 && prepared.rows.length === 0) {
    throw new MessageBodyError(tr('errors.chat.emptyMessage'))
  }

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
    return (await attachToMessages([row!], me))[0]!
  }

  if (input.replyToId) {
    const [target] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, input.replyToId), eq(messages.conversationId, conversationId), isNull(messages.deletedAt)))
    if (!target) throw new ChatRequestError('REPLY_NOT_IN_CONVERSATION')
  }

  const [row] = await db
    .insert(messages)
    .values({ conversationId, authorUserId: me.id, body: trimmed, clientId: input.clientId, replyToId: input.replyToId ?? null })
    .returning()

  const attachmentIds = [...input.attachmentIds, ...copiedAttachmentIds.filter((id): id is string => Boolean(id))]
  await attachAttachments(row!.id, conversationId, attachmentIds, me.id)
  if (prepared.rows.length > 0) {
    await db.insert(messageRefs).values(
      prepared.rows.map((ref, position) => ({
        messageId: row!.id,
        refType: ref.type,
        refId: ref.refId,
        snapshot: copiedAttachmentIds[position] ? { ...ref.card, attachmentId: copiedAttachmentIds[position] } : ref.card,
        position,
      })),
    )
  }
  // Autorul și-a citit mesajul: watermark-ul lui avansează, deci nu îl numără ca necitit.
  await db
    .update(conversationMembers)
    .set({ lastReadMessageId: row!.id })
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, me.id)))

  return (await attachToMessages([row!], me))[0]!
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
  return (await attachToMessages([row], me))[0]!
}

export async function deleteMessage(me: SessionUser, messageId: string): Promise<{ id: string; conversationId: string }> {
  const [row] = await db
    .update(messages)
    .set({ deletedAt: new Date() })
    .where(and(eq(messages.id, messageId), eq(messages.authorUserId, me.id), isNull(messages.deletedAt)))
    .returning({ id: messages.id, conversationId: messages.conversationId })
  if (!row) throw new ConversationForbiddenError(tr('errors.chat.messageNotFound'))
  // The snapshots can hold personal data (an email excerpt, a note): they go with the message.
  await Promise.all([
    db.delete(messageRefs).where(eq(messageRefs.messageId, row.id)),
    db.delete(messageReactions).where(eq(messageReactions.messageId, row.id)),
  ])
  return row
}

/** Active colleagues who manage the team, so a "no access" card knows whom to ask. */
async function accessGrantors(reader: SessionUser): Promise<{ userId: string; name: string }[]> {
  const rows = await db
    .select({ id: users.id, displayName: users.displayName, email: users.email, roleFeatures: roles.features, roleKind: roles.kind })
    .from(users)
    .leftJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.status, 'active'), isNull(users.deletedAt), ne(users.id, reader.id)))
  return rows
    .filter((u) => effectiveFeatures(u.roleFeatures, u.roleKind, reader.tenant).includes('echipa.administrare'))
    .map((u) => ({ userId: u.id, name: u.displayName ?? u.email }))
}

// ── Reactions ───────────────────────────────────────────────────────────────

async function reactableMessage(me: SessionUser, messageId: string): Promise<{ conversationId: string }> {
  const [row] = await db
    .select({ conversationId: messages.conversationId })
    .from(messages)
    .where(and(eq(messages.id, messageId), isNull(messages.deletedAt)))
  if (!row) throw new ConversationForbiddenError(tr('errors.chat.messageNotFound'))
  await assertMember(row.conversationId, me.id)
  return row
}

async function reactionsOf(messageId: string): Promise<ChatReaction[]> {
  const rows = await db
    .select({ messageId: messageReactions.messageId, userId: messageReactions.userId, emoji: messageReactions.emoji })
    .from(messageReactions)
    .where(and(eq(messageReactions.messageId, messageId), isNull(messageReactions.deletedAt)))
    .orderBy(asc(messageReactions.createdAt), asc(messageReactions.id))
  return groupReactions(rows).get(messageId) ?? []
}

export async function addReaction(
  me: SessionUser,
  messageId: string,
  emoji: string,
): Promise<{ conversationId: string; reactions: ChatReaction[] }> {
  const { conversationId } = await reactableMessage(me, messageId)
  await db.insert(messageReactions).values({ messageId, userId: me.id, emoji }).onConflictDoNothing()
  return { conversationId, reactions: await reactionsOf(messageId) }
}

export async function removeReaction(
  me: SessionUser,
  messageId: string,
  emoji: string,
): Promise<{ conversationId: string; reactions: ChatReaction[] }> {
  const { conversationId } = await reactableMessage(me, messageId)
  await db
    .delete(messageReactions)
    .where(and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, me.id), eq(messageReactions.emoji, emoji)))
  return { conversationId, reactions: await reactionsOf(messageId) }
}

// ── Search, media, share targets ────────────────────────────────────────────

const SEARCH_LIMIT = 50

export async function searchMessages(
  me: SessionUser,
  conversationId: string,
  q: string,
): Promise<{ id: string; createdAt: string; authorName: string; body: string }[]> {
  await assertMember(conversationId, me.id)
  const rows = await db
    .select({
      id: messages.id,
      createdAt: messages.createdAt,
      body: messages.body,
      displayName: users.displayName,
      email: users.email,
    })
    .from(messages)
    .innerJoin(users, eq(users.id, messages.authorUserId))
    .where(and(eq(messages.conversationId, conversationId), isNull(messages.deletedAt), foldedIlike(messages.body, q)))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(SEARCH_LIMIT)
  return rows.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), authorName: r.displayName ?? r.email, body: r.body }))
}

export async function listMedia(
  me: SessionUser,
  conversationId: string,
  query: z.infer<typeof MediaQuerySchema>,
): Promise<{
  items: {
    id: string
    messageId: string
    filename: string
    contentType: string
    sizeBytes: number
    width: number | null
    height: number | null
    createdAt: string
  }[]
  nextCursor: string | null
}> {
  await assertMember(conversationId, me.id)
  const filters = [
    eq(messages.conversationId, conversationId),
    isNull(messages.deletedAt),
    isNull(messageAttachments.deletedAt),
    query.kind === 'image' ? like(messageAttachments.contentType, 'image/%') : notLike(messageAttachments.contentType, 'image/%'),
  ]
  if (query.cursor) {
    const [cursor] = await db
      .select({ createdAt: messageAttachments.createdAt, id: messageAttachments.id })
      .from(messageAttachments)
      .where(eq(messageAttachments.id, query.cursor))
    if (cursor) {
      filters.push(
        or(
          lt(messageAttachments.createdAt, cursor.createdAt),
          and(eq(messageAttachments.createdAt, cursor.createdAt), lt(messageAttachments.id, cursor.id)),
        )!,
      )
    }
  }
  const rows = await db
    .select({
      id: messageAttachments.id,
      messageId: messages.id,
      filename: messageAttachments.filename,
      contentType: messageAttachments.contentType,
      sizeBytes: messageAttachments.sizeBytes,
      width: messageAttachments.width,
      height: messageAttachments.height,
      createdAt: messageAttachments.createdAt,
    })
    .from(messageAttachments)
    .innerJoin(messages, eq(messages.id, messageAttachments.messageId))
    .where(and(...filters))
    .orderBy(desc(messageAttachments.createdAt), desc(messageAttachments.id))
    .limit(query.limit + 1)
  const page = rows.slice(0, query.limit)
  return {
    items: page.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    nextCursor: rows.length > query.limit ? page[page.length - 1]!.id : null,
  }
}

export type ShareTarget =
  | { kind: 'conversation'; id: string; title: string; memberIds: string[] }
  | { kind: 'user'; userId: string; displayName: string }

/** Where an object can be sent: the person's conversations by last message, then colleagues without a DM. */
export async function recentTargets(me: SessionUser, q?: string): Promise<ShareTarget[]> {
  const conversationList = await listConversations(me)
  const dmPartners = new Set<string>()
  const targets: ShareTarget[] = conversationList.map((c) => {
    const others = c.members.filter((m) => m.id !== me.id)
    if (c.kind === 'dm') others.forEach((m) => dmPartners.add(m.id))
    const title = c.kind === 'group' ? (c.name ?? '') : others.map((m) => m.displayName ?? m.email).join(', ')
    return { kind: 'conversation', id: c.id, title, memberIds: c.members.map((m) => m.id) }
  })

  const colleagues = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      roleFeatures: roles.features,
      roleKind: roles.kind,
    })
    .from(users)
    .leftJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.status, 'active'), isNull(users.deletedAt), ne(users.id, me.id)))
    .orderBy(asc(sql`coalesce(${users.displayName}, ${users.email})`))
  for (const colleague of colleagues) {
    if (dmPartners.has(colleague.id)) continue
    if (!effectiveFeatures(colleague.roleFeatures, colleague.roleKind, me.tenant).includes('mesaje.view')) continue
    targets.push({ kind: 'user', userId: colleague.id, displayName: colleague.displayName ?? colleague.email })
  }

  if (!q) return targets
  const term = foldDiacritics(q)
  return targets.filter((t) => foldDiacritics(t.kind === 'user' ? t.displayName : t.title).includes(term))
}

/** The reader's conversations where an object was shared ("Discussed in"). */
export async function conversationsWithRef(
  me: SessionUser,
  type: RefType,
  refId: string,
): Promise<{ conversationId: string; title: string; lastSharedAt: string }[]> {
  const rows = await db
    .select({ conversationId: messages.conversationId, lastSharedAt: sql<Date>`max(${messages.createdAt})` })
    .from(messageRefs)
    .innerJoin(messages, eq(messages.id, messageRefs.messageId))
    .innerJoin(
      conversationMembers,
      and(eq(conversationMembers.conversationId, messages.conversationId), eq(conversationMembers.userId, me.id)),
    )
    .where(and(eq(messageRefs.refType, type), eq(messageRefs.refId, refId), isNull(messageRefs.deletedAt), isNull(messages.deletedAt)))
    .groupBy(messages.conversationId)
  if (rows.length === 0) return []
  const titles = new Map(
    (await listConversations(me)).map((c) => [
      c.id,
      c.kind === 'group'
        ? (c.name ?? '')
        : c.members
            .filter((m) => m.id !== me.id)
            .map((m) => m.displayName ?? m.email)
            .join(', '),
    ]),
  )
  return rows
    .map((r) => ({
      conversationId: r.conversationId,
      title: titles.get(r.conversationId) ?? '',
      lastSharedAt: new Date(r.lastSharedAt).toISOString(),
    }))
    .sort((a, b) => b.lastSharedAt.localeCompare(a.lastSharedAt))
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
