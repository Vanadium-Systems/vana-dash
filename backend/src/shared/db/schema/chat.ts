import { sql } from 'drizzle-orm'
import { bigint, boolean, check, index, integer, jsonb, pgTable, smallint, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { users } from './users.js'
import { tenantColumns } from './tenant-column.js'

// Messages between colleagues. Every table carries tenant_id; isolation is done by the RLS policies.

export const conversations = pgTable(
  'conversations',
  {
    ...tenantColumns,
    ...standardColumns,
    kind: text('kind', { enum: ['dm', 'group'] }).notNull(),
    // null la DM (titlul vine din celălalt om), obligatoriu la grup.
    name: text('name'),
    // Doar la DM: id-urile celor doi, sortate, separate prin ':'. Unic pe (tenant_id, dm_key)
    // în Etapa 3; aici indexul e parțial, ca grupurile (dm_key null) să nu intră în conflict.
    dmKey: text('dm_key'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
  },
  (t) => [uniqueIndex('uq_conversations_dm_key').on(t.dmKey).where(sql`${t.kind} = 'dm'`)],
)

export const conversationMembers = pgTable(
  'conversation_members',
  {
    ...tenantColumns,
    ...standardColumns,
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'member'] }).notNull().default('member'),
    lastReadMessageId: uuid('last_read_message_id').references((): AnyPgColumn => messages.id, {
      onDelete: 'set null',
    }),
    muted: boolean('muted').notNull().default(false),
    // Up to when this person's app has received the conversation's messages: the second tick.
    // Moved forward when they load the conversation list or the thread.
    deliveredUpTo: timestamp('delivered_up_to', { withTimezone: true }),
  },
  (t) => [uniqueIndex('uq_conversation_members_user').on(t.conversationId, t.userId)],
)

export const messages = pgTable(
  'messages',
  {
    ...tenantColumns,
    ...standardColumns,
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Gol numai dacă mesajul are atașamente (verificat în service, nu aici).
    body: text('body').notNull().default(''),
    // Generat de client, dedupe la retrimitere (mesaj optimist din FE).
    clientId: uuid('client_id').notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    replyToId: uuid('reply_to_id').references((): AnyPgColumn => messages.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('uq_messages_client_id').on(t.conversationId, t.clientId),
    index('idx_messages_conversation_created').on(t.conversationId, t.createdAt.desc(), t.id),
  ],
)

export const messageAttachments = pgTable(
  'message_attachments',
  {
    ...tenantColumns,
    ...standardColumns,
    // null până la trimiterea mesajului; un upload netrimis în 24h se curăță (job).
    messageId: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    uploadedByUserId: uuid('uploaded_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    storagePath: text('storage_path').notNull(),
    filename: text('filename').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    width: integer('width'),
    height: integer('height'),
    thumbnailPath: text('thumbnail_path'),
  },
  (t) => [
    index('idx_message_attachments_message').on(t.messageId),
    index('idx_message_attachments_unattached').on(t.createdAt),
  ],
)

export const messageReactions = pgTable(
  'message_reactions',
  {
    ...tenantColumns,
    ...standardColumns,
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
  },
  (t) => [
    uniqueIndex('uq_message_reactions').on(t.tenantId, t.messageId, t.userId, t.emoji),
    index('idx_message_reactions_message').on(t.messageId),
    check('ck_message_reactions_emoji', sql`char_length(${t.emoji}) <= 16`),
  ],
)

export const MESSAGE_REF_TYPES = ['prospect', 'invoice', 'email_thread', 'calendar_event', 'archive_file', 'note'] as const
export type MessageRefType = (typeof MESSAGE_REF_TYPES)[number]

// An object shared into a message. `snapshot` is what the sender saw when sending: personal
// objects are always shown from it, firm objects fall back to it once deleted.
export const messageRefs = pgTable(
  'message_refs',
  {
    ...tenantColumns,
    ...standardColumns,
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    refType: text('ref_type', { enum: MESSAGE_REF_TYPES }).notNull(),
    refId: uuid('ref_id').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull(),
    position: smallint('position').notNull().default(0),
  },
  (t) => [
    index('idx_message_refs_message').on(t.messageId),
    index('idx_message_refs_target').on(t.tenantId, t.refType, t.refId),
    check(
      'ck_message_refs_type',
      sql`${t.refType} IN ('prospect', 'invoice', 'email_thread', 'calendar_event', 'archive_file', 'note')`,
    ),
  ],
)
