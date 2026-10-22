import { index, jsonb, pgTable, text, timestamp, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { users } from './users.js'
import { tenantColumns } from './tenant-column.js'

// Istoricul „cine a făcut ce" (PLAN.md C2). APPEND-ONLY: fără `updated_at` și fără
// `deleted_at` (restul tabelelor au coloanele standard) — o intrare de audit nu se editează și
// nu se șterge, nici mă de soft delete. `actor_user_id` null = job sau system.
// Retenția se decide în LEGAL, la Etapa 3; în Etapa 1 nu se șterge nimic automat.
export const auditLog = pgTable(
  'audit_log',
  {
    ...tenantColumns,
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    // { camp: [vechi, nou] } — secretele sunt excluse la scriere (shared/lib/audit.ts).
    changes: jsonb('changes').$type<Record<string, [unknown, unknown]>>(),
    ip: text('ip'),
  },
  (t) => [
    // Panoul de istoric de pe un obiect (entity_type + entity_id, cronologic).
    index('ix_audit_log_entity').on(t.entityType, t.entityId, t.createdAt),
    // Pagina Istoric, filtrată pe om.
    index('ix_audit_log_actor').on(t.actorUserId, t.createdAt),
  ],
)
