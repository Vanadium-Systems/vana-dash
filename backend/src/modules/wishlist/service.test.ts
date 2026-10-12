/**
 * Integration test — pg real (test/setup.ts). Verifică agregarea SQL pe categorie
 * (getWishlistTotals) și flow-ul purchase cu addExpense (opt-in, niciodată automat).
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { financialRecords, wishlistItems , roles, users} from '../../shared/db/schema/index.js'
import * as service from './service.js'

import { effectiveFeatures } from '../../shared/lib/session.js'
import type { SessionUser } from '../../shared/lib/session.js'

// Admin de test: toate cutiile (mailboxes null) și toate funcționalitățile.
const admin = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'stefan@vanadium.systems',
  displayName: 'Stefan',
  role: { id: '00000000-0000-4000-8000-000000000002', name: 'Admin', kind: 'admin' as const },
  isPlatformAdmin: true,
  features: effectiveFeatures([], 'admin'),
  mailboxes: null,
  status: 'active' as const,
  lastSeenAt: null,
  notificationPrefs: null,
  navLayout: null,
  updatesSeenAt: null,
  locale: 'ro',
  displayCurrency: 'RON',
  sessionVersion: 1,
} satisfies SessionUser
const [adminRoleRow] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const [adminUserRow] = await db.select({ id: users.id }).from(users).where(eq(users.roleId, adminRoleRow!.id)).limit(1)
admin.id = adminUserRow!.id


const itemIds: string[] = []
const recordIds: string[] = []

afterAll(async () => {
  if (recordIds.length) await db.delete(financialRecords).where(inArray(financialRecords.id, recordIds))
  if (itemIds.length) await db.delete(wishlistItems).where(inArray(wishlistItems.id, itemIds))
})

describe('getWishlistTotals', () => {
  it('sumează estimated_price pe categorie, doar pt. itemii necumpărați', async () => {
    const a = await service.createWishlistItem(admin, { title: 'QA necesitate 1', category: 'necesitate', estimatedPrice: 100, currency: 'RON' })
    const b = await service.createWishlistItem(admin, { title: 'QA necesitate 2', category: 'necesitate', estimatedPrice: 50, currency: 'RON' })
    const c = await service.createWishlistItem(admin, { title: 'QA placere 1', category: 'placere', estimatedPrice: 30, currency: 'RON' })
    itemIds.push(a!.id, b!.id, c!.id)

    // Cumpărat — nu trebuie să mai intre în total.
    await service.purchaseWishlistItem(admin, b!.id, {})

    const totals = await service.getWishlistTotals(admin, )
    const necesitate = totals.find((t) => t.category === 'necesitate' && t.scope === 'personal')
    const placere = totals.find((t) => t.category === 'placere' && t.scope === 'personal')

    expect(necesitate?.total).toBe(100)
    expect(placere?.total).toBe(30)
  })

  it('separă totalurile pe scope (personal vs. firmă), nu le adună', async () => {
    const personal = await service.createWishlistItem(admin, { title: 'QA personal', category: 'necesitate', scope: 'personal', estimatedPrice: 200, currency: 'RON' })
    const firma = await service.createWishlistItem(admin, { title: 'QA firma', category: 'necesitate', scope: 'firma', estimatedPrice: 500, currency: 'RON' })
    itemIds.push(personal!.id, firma!.id)

    const totals = await service.getWishlistTotals(admin, )
    const personalTotal = totals.find((t) => t.category === 'necesitate' && t.scope === 'personal')?.total ?? 0
    const firmaTotal = totals.find((t) => t.category === 'necesitate' && t.scope === 'firma')?.total ?? 0

    expect(firmaTotal).toBe(500)
    expect(personalTotal).toBeGreaterThanOrEqual(200)
    expect(personalTotal).not.toBe(firmaTotal)
  })
})

describe('purchaseWishlistItem', () => {
  it('marchează cumpărat FĂRĂ să scrie financial_records dacă addExpense nu e bifat', async () => {
    const item = await service.createWishlistItem(admin, { title: 'QA no expense', category: 'placere', estimatedPrice: 77, currency: 'RON' })
    itemIds.push(item!.id)

    const row = await service.purchaseWishlistItem(admin, item!.id, {})
    expect(row?.purchased).toBe(true)
    expect(row?.financialRecordId).toBeNull()
  })

  it('scrie un financial_record ca cheltuială (direction=in) când addExpense=true', async () => {
    const item = await service.createWishlistItem(admin, { title: 'QA with expense', category: 'necesitate', estimatedPrice: 123.45, currency: 'RON' })
    itemIds.push(item!.id)

    const row = await service.purchaseWishlistItem(admin, item!.id, { addExpense: true })
    expect(row?.financialRecordId).toBeTruthy()
    recordIds.push(row!.financialRecordId!)

    const [record] = await db.select().from(financialRecords).where(eq(financialRecords.id, row!.financialRecordId!))
    expect(record?.type).toBe('expense')
    expect(record?.direction).toBe('in')
    expect(record?.amount).toBe('123.45')
  })
})
