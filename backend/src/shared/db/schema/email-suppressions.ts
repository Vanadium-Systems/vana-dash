import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'

// 2026-08-11 — sursa de adevăr pt. "nu mai trimite aici", populată prin click pe link-ul de
// dezabonare din footer-ul bulk-send (modules/email/unsubscribe-token.ts). Distinct de
// email_blocklist (acela e inbound — spam sender → trash automat la primire, scop diferit).
export const emailSuppressions = pgTable(
  'email_suppressions',
  {
    ...standardColumns,
    // Normalizată lowercase la insert/compare (ca email_blocklist.address).
    email: text('email').notNull(),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    // 2026-09-03 — distincție manual (click pe link) vs. automat (hard-bounce/complaint), pt.
    // pagina „Dezabonări" din Setări Email. Rândurile vechi (înainte de migrare) devin implicit
    // 'manual' — nu se poate reconstrui retroactiv care au fost de fapt bounce.
    source: text('source', { enum: ['manual', 'bounce', 'complaint'] }).notNull().default('manual'),
  },
  (t) => [uniqueIndex('uq_email_suppressions_email').on(t.email)],
)
