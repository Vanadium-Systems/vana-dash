import { boolean, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { financialRecords } from './financial-records.js'
import { users } from './users.js'

export const wishlistItems = pgTable(
  'wishlist_items',
  {
    ...standardColumns,
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    category: text('category', { enum: ['necesitate', 'placere'] }).notNull(),
    // Sprint mobil, follow-up (2026-07-22) — Stefan vrea wishlist-ul personal și cel de firmă
    // în același loc, dar separabile ("medii separate": necesitate/placere × personal/firma).
    scope: text('scope', { enum: ['personal', 'firma'] }).notNull().default('personal'),
    priority: text('priority', { enum: ['low', 'medium', 'high'] }).notNull().default('medium'),
    estimatedPrice: numeric('estimated_price', { precision: 14, scale: 2 }),
    currency: text('currency').notNull().default('RON'),
    link: text('link'),
    purchased: boolean('purchased').notNull().default(false),
    purchasedAt: timestamp('purchased_at', { withTimezone: true }),
    // Setat doar dacă "adaugă ca cheltuială" a fost bifat explicit la marcarea ca cumpărat —
    // niciodată scris automat (regula SEC din PLAN.md).
    financialRecordId: uuid('financial_record_id').references(() => financialRecords.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [index('ix_wishlist_scope_category_purchased').on(t.scope, t.category, t.purchased)],
)
