import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { roles } from './roles.js'

// Coloanele de autor (istoric „cine a făcut ce", PLAN.md C2). Nullable cu backfill = Stefan:
// în Etapa 1 un singur om, deci valoarea vine acum, iar NOT NULL se pune când fiecare cale de
// scriere trece prin contextul requestului (BE-7). Diff-ul exclude secretele — vezi
// shared/lib/audit.ts.
export const auditColumns = {
  createdByUserId: uuid('created_by_user_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  updatedByUserId: uuid('updated_by_user_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
}

// Preferințele de notificare per om (canale push + email). null = default-urile aplicației,
// rezolvate în `GET /api/auth/me`; null e starea rândurilor existente, nu o variantă nouă.
export interface NotificationPrefs {
  chat: 'all' | 'dm' | 'none'
  emailNew: boolean
  alerts: boolean
}

export const users = pgTable(
  'users',
  {
    ...standardColumns,
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name'),
    // Rolul de acces (PLAN.md C2). null = noul user n-are încă rol; `is_platform_admin` e
    // doar pentru contul lui Stefan (vede tot, inclusiv firmele-client din Etapa 3).
    roleId: uuid('role_id').references((): AnyPgColumn => roles.id, { onDelete: 'set null' }),
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    // 'invited' = invitația trimisă, parola nesetată; 'disabled' = delogat la următorul request
    // (crește session_version, deci sesiunile vechi primesc 401).
    status: text('status', { enum: ['invited', 'active', 'disabled'] }).notNull().default('active'),
    sessionVersion: integer('session_version').notNull().default(1),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    notificationPrefs: jsonb('notification_prefs').$type<NotificationPrefs>(),
    // Ordinea + vizibilitatea nav-ului, mutate de pe dashboard_config['nav.layout'] (rândul
    // acela se șterge în Wave 2, când serviciul citește de aici).
    navLayout: jsonb('nav_layout'),
    // Până când a văzut omul pagina Noutăți (PLAN.md C5): ce e mai nou e marcat „Nou”. Pe user,
    // nu în browser, ca telefonul și desktopul să fie de acord.
    updatesSeenAt: timestamp('updates_seen_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_users_email').on(t.email),
    index('ix_users_role').on(t.roleId),
  ],
)
