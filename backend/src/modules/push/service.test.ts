/**
 * Integration test — pg real (test/setup.ts). Verifică upsert pe endpoint (re-subscribe
 * reactivează un rând soft-deleted) și unsubscribe soft-delete.
 */
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { pushSubscriptions, roles, users } from '../../shared/db/schema/index.js'
import * as service from './service.js'

import { effectiveFeatures } from '../../shared/lib/session.js'
import type { SessionUser } from '../../shared/lib/session.js'

// Admin de test: toate cutiile și toate funcționalitățile (mailboxes null).
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
  sessionVersion: 1,
} satisfies SessionUser
const [adminRoleRow] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const [adminUserRow] = await db.select({ id: users.id }).from(users).where(eq(users.roleId, adminRoleRow!.id)).limit(1)
admin.id = adminUserRow!.id


const ENDPOINT = 'https://qa.example.invalid/push-subscription/abc123'

afterAll(async () => {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, ENDPOINT))
})

describe('push subscribe/unsubscribe', () => {
  it('subscribe face upsert pe endpoint (re-subscribe nu creează duplicat)', async () => {
    const first = await service.subscribe(admin, {
      endpoint: ENDPOINT,
      keys: { p256dh: 'p256dh-1', auth: 'auth-1' },
      deviceLabel: 'Samsung S23',
    })
    expect(first?.deviceLabel).toBe('Samsung S23')

    const second = await service.subscribe(admin, {
      endpoint: ENDPOINT,
      keys: { p256dh: 'p256dh-2', auth: 'auth-2' },
      deviceLabel: 'Samsung S23 (reinstall)',
    })
    expect(second?.id).toBe(first?.id) // același rând, nu duplicat
    expect(second?.p256dhKey).toBe('p256dh-2')

    const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, ENDPOINT))
    expect(rows).toHaveLength(1)
  })

  it('unsubscribe soft-delete + re-subscribe reactivează rândul (deletedAt=null)', async () => {
    await service.unsubscribe(admin, ENDPOINT)
    const [deleted] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, ENDPOINT))
    expect(deleted?.deletedAt).not.toBeNull()

    await service.subscribe(admin, { endpoint: ENDPOINT, keys: { p256dh: 'p256dh-3', auth: 'auth-3' } })
    const [reactivated] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, ENDPOINT))
    expect(reactivated?.deletedAt).toBeNull()
  })
})
