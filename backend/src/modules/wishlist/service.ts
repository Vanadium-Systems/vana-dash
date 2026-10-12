import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { financialRecords, wishlistItems } from '../../shared/db/schema/index.js'
import { displayMoney } from '../../shared/lib/display-money.js'
import { displayAmountSql } from '../../shared/lib/sql-fx.js'
import type {
  CreateWishlistItemSchema,
  ListWishlistQuerySchema,
  PurchaseWishlistItemSchema,
  UpdateWishlistItemSchema,
} from './schema.js'
import type { z } from 'zod'

type CreateInput = z.infer<typeof CreateWishlistItemSchema>
type UpdateInput = z.infer<typeof UpdateWishlistItemSchema>
type ListQuery = z.infer<typeof ListWishlistQuerySchema>
type PurchaseInput = z.infer<typeof PurchaseWishlistItemSchema>

export async function listWishlistItems(me: SessionUser, query: ListQuery) {
  const filters = [isNull(wishlistItems.deletedAt), eq(wishlistItems.ownerUserId, me.id)]
  if (query.category) filters.push(eq(wishlistItems.category, query.category))
  if (query.scope) filters.push(eq(wishlistItems.scope, query.scope))
  if (query.purchased !== undefined) filters.push(eq(wishlistItems.purchased, query.purchased))

  return db
    .select()
    .from(wishlistItems)
    .where(and(...filters))
    .orderBy(desc(wishlistItems.createdAt))
}

/**
 * "Cât mai ai de cumpărat" per scope × categorie — SUM pe estimated_price al itemilor NU încă
 * cumpărați, în moneda de afișare (`displayAmountSql`, itemii pot avea preț estimat în EUR/USD). Agregare SQL
 * (regula #9 CLAUDE.md), nu `.reduce()` pe array-ul din `listWishlistItems`. Frontend agregă
 * mai departe pe scope='toate' (sumă peste ambele scope-uri per categorie) — vezi WishlistPage.
 */
export async function getWishlistTotals(me: SessionUser) {
  const displayAmount = displayAmountSql(
    sql`COALESCE(${wishlistItems.estimatedPrice}, 0)`,
    wishlistItems.currency,
    wishlistItems.createdAt,
    (await displayMoney()).currency,
  )
  return db
    .select({
      scope: wishlistItems.scope,
      category: wishlistItems.category,
      total: sql<number>`COALESCE(SUM(${displayAmount}), 0)::float`,
    })
    .from(wishlistItems)
    .where(and(isNull(wishlistItems.deletedAt), eq(wishlistItems.purchased, false), eq(wishlistItems.ownerUserId, me.id)))
    .groupBy(wishlistItems.scope, wishlistItems.category)
}

export async function createWishlistItem(me: SessionUser, input: CreateInput) {
  const [row] = await db
    .insert(wishlistItems)
    .values({
      ownerUserId: me.id,
      title: input.title,
      category: input.category,
      scope: input.scope,
      priority: input.priority,
      estimatedPrice: input.estimatedPrice !== undefined ? String(input.estimatedPrice) : undefined,
      currency: input.currency,
      link: input.link,
    })
    .returning()
  return row
}

export async function updateWishlistItem(me: SessionUser, id: string, input: UpdateInput) {
  const { estimatedPrice, ...rest } = input
  const [row] = await db
    .update(wishlistItems)
    .set({
      ...rest,
      ...(estimatedPrice !== undefined ? { estimatedPrice: estimatedPrice === null ? null : String(estimatedPrice) } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(wishlistItems.id, id), eq(wishlistItems.ownerUserId, me.id),
      isNull(wishlistItems.deletedAt)))
    .returning()
  return row
}

export async function deleteWishlistItem(me: SessionUser, id: string) {
  const [row] = await db
    .update(wishlistItems)
    .set({ deletedAt: new Date() })
    .where(and(eq(wishlistItems.id, id), eq(wishlistItems.ownerUserId, me.id),
      isNull(wishlistItems.deletedAt)))
    .returning()
  return row
}

/**
 * Marchează cumpărat. `addExpense` e opt-in explicit (checkbox din UI, niciodată implicit —
 * la fel ca "Aplică la client" din Pricing) — scrie un `financial_records` cu
 * `direction='in'` (cheltuială, la fel ca `jobs/recurring-expenses.ts` materializeRecurringExpense
 * — 'in' = document primit/cheltuială, 'out' = venit emis de Stefan, vezi comentariul din
 * schema `financial-records.ts`).
 */
export async function purchaseWishlistItem(me: SessionUser, id: string, input: PurchaseInput) {
  const [item] = await db
    .select()
    .from(wishlistItems)
    .where(and(eq(wishlistItems.id, id), eq(wishlistItems.ownerUserId, me.id),
      isNull(wishlistItems.deletedAt)))
  if (!item) return null

  let financialRecordId: string | null = null
  if (input.addExpense && item.estimatedPrice) {
    const [record] = await db
      .insert(financialRecords)
      .values({
        type: 'expense',
        direction: 'in',
        amount: item.estimatedPrice,
        currency: item.currency,
        description: item.title,
        issuedAt: new Date(),
        category: 'wishlist',
        source: 'manual',
        paymentStatus: 'paid',
        paidAt: new Date(),
      })
      .returning({ id: financialRecords.id })
    financialRecordId = record?.id ?? null
  }

  const [row] = await db
    .update(wishlistItems)
    .set({
      purchased: true,
      purchasedAt: new Date(),
      financialRecordId,
      updatedAt: new Date(),
    })
    .where(eq(wishlistItems.id, id))
    .returning()
  return row
}
