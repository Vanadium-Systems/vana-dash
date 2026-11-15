import { sql } from 'drizzle-orm'
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { users } from './users.js'
import { tenantColumns } from './tenant-column.js'

// Personal API tokens (Bearer `vd_…`). Only the SHA-256 of the token is stored; the clear token is
// shown once, at creation. No `deleted_at`: a revoked token stays as history and can never be
// reactivated, so a leaked one cannot come back.
export const apiTokens = pgTable(
  'api_tokens',
  {
    ...tenantColumns,
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    // First 8 characters after `vd_`, the only part shown again.
    prefix: text('prefix').notNull(),
    // null = everything the person's role allows; otherwise a subset, intersected at every request.
    features: text('features').array(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastUsedIp: text('last_used_ip'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_api_tokens_hash').on(t.tokenHash),
    index('ix_api_tokens_user').on(t.userId).where(sql`${t.revokedAt} IS NULL`),
    check('ck_api_tokens_name', sql`char_length(${t.name}) BETWEEN 1 AND 80`),
  ],
)
