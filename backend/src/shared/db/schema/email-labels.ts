import { sql } from 'drizzle-orm'
import { boolean, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { tenantColumns } from './tenant-column.js'
import { users } from './users.js'

// Etichete create de Stefan (ex: "Contabilitate", "ANAF") — un singur label per mesaj
// (nu multi-label ca Gmail, decizie din PLAN.md — suficient pt. rutare simplă, extensibil ulterior).
export const emailLabels = pgTable(
  'email_labels',
  {
    ...tenantColumns,
    ...standardColumns,
    name: text('name').notNull(),
    color: text('color'),
    // 2026-08-20, cerere Stefan — rapoartele DMARC (etichetate automat prin email_rules) îi
    // inundau notificările push. Un mesaj primit cu acest label pe true nu mai declanșează
    // notifyPush('email', ...) — mesajul tot ajunge normal în inbox/etichetat, doar push-ul se sare.
    notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
    // null = the company's label; set = a person's own label, visible only to them.
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [
    uniqueIndex('uq_email_labels_company')
      .on(t.tenantId, t.name)
      .where(sql`${t.ownerUserId} IS NULL AND ${t.deletedAt} IS NULL`),
    uniqueIndex('uq_email_labels_owner')
      .on(t.tenantId, t.ownerUserId, t.name)
      .where(sql`${t.ownerUserId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
  ],
)
