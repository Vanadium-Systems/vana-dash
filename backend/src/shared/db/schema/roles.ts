import { sql } from 'drizzle-orm'
import { index, pgTable, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { users } from './users.js'
import { tenantColumns } from './tenant-column.js'

// Rolurile de acces (PLAN.md C2). În Etapa 1 există o singură firmă, deci fără `tenant_id`
// (vine în Etapa 3, pe tot inventarul). `features` = chei din shared/lib/features.ts; gol la
// `manager` și la rolurile `custom`. Rolul `admin` nu are listă: primește tot ce are firma.
export const roles = pgTable(
  'roles',
  {
    ...tenantColumns,
    ...standardColumns,
    name: text('name').notNull(),
    kind: text('kind', { enum: ['admin', 'manager', 'custom'] }).notNull().default('custom'),
    features: text('features')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdByUserId: uuid('created_by_user_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  },
  (t) => [uniqueIndex('uq_roles_name').on(t.tenantId, t.name)],
)

// Token-uri de unică folosire: invitație (72h), resetare de parolă (1h), înscriere (24h).
// Se păstrează doar hash-ul SHA-256 al tokenului din link — tokenul clar nu ajunge în DB
// și nu apare în loguri.
export const userTokens = pgTable(
  'user_tokens',
  {
    ...tenantColumns,
    ...standardColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['invite', 'reset', 'signup'] }).notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_user_tokens_hash').on(t.tokenHash),
    index('ix_user_tokens_user_kind').on(t.userId, t.kind),
  ],
)

// Cutii de email atribuite unui om (PLAN.md C2). `identity_key` = cheia unei identități din
// Setări Email (email.identities), deci fără enum. Adminul nu are rânduri: are toate cutiile
// implicit. Fără unicitate pe `identity_key` — aceeași cutie poate fi la mai mulți oameni.
export const userMailboxes = pgTable(
  'user_mailboxes',
  {
    ...tenantColumns,
    ...standardColumns,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    identityKey: text('identity_key').notNull(),
  },
  (t) => [uniqueIndex('uq_user_mailboxes_user_identity').on(t.userId, t.identityKey)],
)
