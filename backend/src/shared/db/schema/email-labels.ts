import { boolean, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'

// Etichete create de Stefan (ex: "Contabilitate", "ANAF") — un singur label per mesaj
// (nu multi-label ca Gmail, decizie din PLAN.md — suficient pt. rutare simplă, extensibil ulterior).
export const emailLabels = pgTable(
  'email_labels',
  {
    ...standardColumns,
    name: text('name').notNull(),
    color: text('color'),
    // 2026-08-20, cerere Stefan — rapoartele DMARC (etichetate automat prin email_rules) îi
    // inundau notificările push. Un mesaj primit cu acest label pe true nu mai declanșează
    // notifyPush('email', ...) — mesajul tot ajunge normal în inbox/etichetat, doar push-ul se sare.
    notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
  },
  (t) => [uniqueIndex('uq_email_labels_name').on(t.name)],
)
