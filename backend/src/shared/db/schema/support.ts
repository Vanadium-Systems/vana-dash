import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { users } from './users.js'
import { tenantColumns } from './tenant-column.js'

// Tichete de suport către Vanadium (PLAN.md C5). Un om vede doar tichetele lui; administratorul
// de platformă le vede pe toate. Cele două steaguri de necitit țin loc de tabel de citiri:
// un tichet are exact două părți, autorul și platforma.

export const supportTickets = pgTable(
  'support_tickets',
  {
    ...tenantColumns,
    ...standardColumns,
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    subject: text('subject').notNull(),
    description: text('description').notNull(),
    status: text('status', { enum: ['deschis', 'raspuns', 'inchis'] }).notNull().default('deschis'),
    // Ruta din aplicație de unde a fost deschis tichetul (`/accounting`), ca să se vadă contextul.
    page: text('page'),
    unreadByPlatform: boolean('unread_by_platform').notNull().default(true),
    unreadByAuthor: boolean('unread_by_author').notNull().default(false),
    // Ultima mișcare (crearea sau ultimul răspuns), pentru ordinea din liste.
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ix_support_tickets_author').on(t.createdByUserId, t.lastActivityAt),
    index('ix_support_tickets_activity').on(t.lastActivityAt),
  ],
)

export const supportTicketReplies = pgTable(
  'support_ticket_replies',
  {
    ...tenantColumns,
    ...standardColumns,
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => supportTickets.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    isPlatformReply: boolean('is_platform_reply').notNull().default(false),
  },
  (t) => [index('ix_support_ticket_replies_ticket').on(t.ticketId, t.createdAt)],
)
