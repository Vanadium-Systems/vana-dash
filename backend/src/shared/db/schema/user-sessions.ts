import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { users } from './users.js'
import { tenantColumns } from './tenant-column.js'

// Login sessions with rotating refresh tokens. Each login starts a family; every refresh replaces
// the row with a new one in the same family. Presenting a token that was already replaced (outside a
// short grace window) means it was copied: the whole family is revoked. Only the SHA-256 of the
// refresh secret is stored.
export const userSessions = pgTable(
  'user_sessions',
  {
    ...tenantColumns,
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    // users.session_version when the family started: a password change or deactivation ends it.
    sessionVersion: integer('session_version').notNull(),
    deviceLabel: text('device_label'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // Last time the person typed their password in this session (sensitive actions ask again after 10 minutes).
    passwordConfirmedAt: timestamp('password_confirmed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    // 'rotated' | 'logout' | 'reuse' | 'password' | 'disabled' | 'expired'
    revokeReason: text('revoke_reason'),
    replacedById: uuid('replaced_by_id'),
  },
  (t) => [
    uniqueIndex('uq_user_sessions_hash').on(t.tokenHash),
    index('ix_user_sessions_family').on(t.familyId),
    index('ix_user_sessions_user').on(t.userId, t.lastUsedAt),
  ],
)
