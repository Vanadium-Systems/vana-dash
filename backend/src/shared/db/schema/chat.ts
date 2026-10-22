import { sql } from 'drizzle-orm'
import { bigint, boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { users } from './users.js'
import { tenantColumns } from './tenant-column.js'

// Mesaje între oameni (PLAN.md C3). Fără `tenant_id` în Etapa 1 (singura firmă); intră în
// inventarul retrofit-ului din Etapa 3.

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
