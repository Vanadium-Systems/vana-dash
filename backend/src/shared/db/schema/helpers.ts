import { timestamp, uuid } from 'drizzle-orm/pg-core'

// Coloanele standard pe fiecare tabelă (CLAUDE.md): id + timestamps + soft delete.
export const standardColumns = {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}
