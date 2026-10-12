/**
 * Integration test — pg real (test/setup.ts). Verifică deblocarea secvențială (computeStatus,
 * status e strict informativ — completarea NU e blocată), reorderGoals (valid + id lipsă/în
 * plus → InvalidReorderError), soft delete, și transferul thresholdType manual↔mrr_ron.
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { planGoals, roles, users } from '../../shared/db/schema/index.js'
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
  locale: 'ro',
  displayCurrency: 'RON',
  sessionVersion: 1,
} satisfies SessionUser
const [adminRoleRow] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const [adminUserRow] = await db.select({ id: users.id }).from(users).where(eq(users.roleId, adminRoleRow!.id)).limit(1)
admin.id = adminUserRow!.id


const goalIds: string[] = []

afterAll(async () => {
  if (goalIds.length) await db.delete(planGoals).where(inArray(planGoals.id, goalIds))
})

/** Rând minimal fabricat — computeStatus citește doar completedAt, restul e irelevant pt. logica testată. */
function fakeRow(completedAt: Date | null) {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    scope: 'firma',
    tier: 1,
    position: 1,
    title: 'x',
    note: null,
    thresholdType: 'manual',
    thresholdValue: null,
    monthlyCostRon: null,
    completedAt,
  } as unknown as Parameters<typeof service.computeStatus>[0][number]
}

describe('computeStatus (unitar, fără DB)', () => {
  it('anularea unui pas din mijlocul unei secvențe deja completate re-blochează tot ce urmează (regresie 2026-07-25)', () => {
    const a = fakeRow(new Date())
    const b = fakeRow(null) // anulat — nu mai e completat
    const c = fakeRow(new Date()) // rămas bifat (completarea nu se anulează automat)
    const d = fakeRow(null) // niciodată completat

    const [, sb, , sd] = service.computeStatus([a, b, c, d])
    expect(sb!.status).toBe('available')
    expect(sd!.status).toBe('locked')
  })

  it('primul pas necompletat e mereu available dacă toate cele dinainte sunt completate', () => {
    const [, s2] = service.computeStatus([fakeRow(new Date()), fakeRow(null)])
    expect(s2!.status).toBe('available')
  })
})

describe('getPlan / computeStatus', () => {
  it('primul pas e mereu available, restul locked până termini pasul anterior', async () => {
    const a = await service.createGoal(admin, { scope: 'personal', tier: 1, title: 'QA pas 1', thresholdType: 'manual' })
    const b = await service.createGoal(admin, { scope: 'personal', tier: 1, title: 'QA pas 2', thresholdType: 'manual' })
    const c = await service.createGoal(admin, { scope: 'personal', tier: 1, title: 'QA pas 3', thresholdType: 'manual' })
    goalIds.push(a!.id, b!.id, c!.id)

    const plan = await service.getPlan(admin)
    const [pa, pb, pc] = plan.personal.filter((g) => goalIds.includes(g.id))
    expect(pa?.status).toBe('available')
    expect(pb?.status).toBe('locked')
    expect(pc?.status).toBe('locked')
  })

  it('completarea NU e blocată de status — poți bifa pasul 3 fără să termini pasul 2', async () => {
    const a = await service.createGoal(admin, { scope: 'firma', tier: 1, title: 'QA firma 1', thresholdType: 'manual' })
    const b = await service.createGoal(admin, { scope: 'firma', tier: 1, title: 'QA firma 2', thresholdType: 'manual' })
    goalIds.push(a!.id, b!.id)

    const completed = await service.setCompleted(admin, b!.id, { completed: true })
    expect(completed?.completedAt).not.toBeNull()

    const plan = await service.getPlan(admin)
    const pb = plan.firma.find((g) => g.id === b!.id)
    expect(pb?.status).toBe('completed')
  })

  it('include mrrRon în răspuns', async () => {
    const plan = await service.getPlan(admin)
    expect(typeof plan.mrrRon).toBe('number')
  })
})

describe('reorderGoals', () => {
  it('rescrie pozițiile în ordinea dată (scoped pe scope+tier)', async () => {
    // Tier 2, izolat de goal-urile tier 1 create în describe-ul de mai sus — reorderGoals
    // validează STRICT setul complet al ACELUI etaj, nu tot scope-ul.
    const a = await service.createGoal(admin, { scope: 'personal', tier: 2, title: 'QA reorder A', thresholdType: 'manual' })
    const b = await service.createGoal(admin, { scope: 'personal', tier: 2, title: 'QA reorder B', thresholdType: 'manual' })
    goalIds.push(a!.id, b!.id)

    const reordered = await service.reorderGoals(admin, 'personal', 2, [b!.id, a!.id])
    const rb = reordered.find((g) => g.id === b!.id)
    expect(rb!.position).toBe(1)
  })

  it('respinge un orderedIds cu un id lipsă din etaj', async () => {
    const a = await service.createGoal(admin, { scope: 'personal', tier: 3, title: 'QA reorder C', thresholdType: 'manual' })
    const b = await service.createGoal(admin, { scope: 'personal', tier: 3, title: 'QA reorder D', thresholdType: 'manual' })
    goalIds.push(a!.id, b!.id)

    await expect(service.reorderGoals(admin, 'personal', 3, [a!.id])).rejects.toThrow(service.InvalidReorderError)
  })

  it('respinge un orderedIds cu un id în plus (din altă pistă/etaj)', async () => {
    const a = await service.createGoal(admin, { scope: 'personal', tier: 4, title: 'QA reorder E', thresholdType: 'manual' })
    const foreign = await service.createGoal(admin, { scope: 'firma', tier: 4, title: 'QA reorder foreign', thresholdType: 'manual' })
    goalIds.push(a!.id, foreign!.id)

    await expect(service.reorderGoals(admin, 'personal', 4, [a!.id, foreign!.id])).rejects.toThrow(service.InvalidReorderError)
  })
})

describe('updateGoal — tranziții thresholdType', () => {
  it('curăță thresholdValue la null când thresholdType devine manual', async () => {
    const goal = await service.createGoal(admin, {
      scope: 'firma',
      tier: 1,
      title: 'QA threshold',
      thresholdType: 'mrr_ron',
      thresholdValue: 10000,
    })
    goalIds.push(goal!.id)

    const updated = await service.updateGoal(admin, goal!.id, { thresholdType: 'manual' })
    expect(updated?.thresholdValue).toBeNull()
  })

  it('respinge trecerea la mrr_ron fără thresholdValue (nici în body, nici pe rând)', async () => {
    const goal = await service.createGoal(admin, { scope: 'firma', tier: 1, title: 'QA threshold 2', thresholdType: 'manual' })
    goalIds.push(goal!.id)

    await expect(service.updateGoal(admin, goal!.id, { thresholdType: 'mrr_ron' })).rejects.toThrow(
      service.ThresholdValueRequiredError,
    )
  })
})

describe('tier + monthlyCostRon', () => {
  it('creează cu tier și monthlyCostRon, le poate schimba prin updateGoal', async () => {
    const goal = await service.createGoal(admin, {
      scope: 'firma',
      tier: 2,
      title: 'QA sales freelance',
      thresholdType: 'manual',
      monthlyCostRon: 1500,
    })
    goalIds.push(goal!.id)
    expect(goal!.tier).toBe(2)
    expect(goal!.monthlyCostRon).toBe('1500.00')

    const updated = await service.updateGoal(admin, goal!.id, { tier: 3, monthlyCostRon: 2000 })
    expect(updated?.tier).toBe(3)
    expect(updated?.monthlyCostRon).toBe('2000.00')

    const cleared = await service.updateGoal(admin, goal!.id, { monthlyCostRon: null })
    expect(cleared?.monthlyCostRon).toBeNull()
  })

  it('ordonează goal-urile din getPlan pe (tier, position)', async () => {
    const t2 = await service.createGoal(admin, { scope: 'firma', tier: 2, title: 'QA tier order 2', thresholdType: 'manual' })
    const t1 = await service.createGoal(admin, { scope: 'firma', tier: 1, title: 'QA tier order 1', thresholdType: 'manual' })
    goalIds.push(t2!.id, t1!.id)

    const plan = await service.getPlan(admin)
    const idxT1 = plan.firma.findIndex((g) => g.id === t1!.id)
    const idxT2 = plan.firma.findIndex((g) => g.id === t2!.id)
    expect(idxT1).toBeLessThan(idxT2)
  })
})

describe('deleteGoal', () => {
  it('soft delete — nu mai apare în getPlan', async () => {
    const goal = await service.createGoal(admin, { scope: 'personal', tier: 1, title: 'QA delete', thresholdType: 'manual' })
    goalIds.push(goal!.id)

    await service.deleteGoal(admin, goal!.id)
    const plan = await service.getPlan(admin)
    expect(plan.personal.some((g) => g.id === goal!.id)).toBe(false)
  })
})
