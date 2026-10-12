import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { planGoals } from '../../shared/db/schema/index.js'
import { getCurrentMrr } from '../../shared/lib/financial-aggregation.js'
import type { CompleteGoalSchema, CreatePlanGoalSchema, UpdatePlanGoalSchema } from './schema.js'
import type { z } from 'zod'

type CreateInput = z.infer<typeof CreatePlanGoalSchema>
type UpdateInput = z.infer<typeof UpdatePlanGoalSchema>
type CompleteInput = z.infer<typeof CompleteGoalSchema>
type PlanScope = 'personal' | 'firma'
type Row = typeof planGoals.$inferSelect

export class InvalidReorderError extends Error {}
export class ThresholdValueRequiredError extends Error {}

/**
 * Deblocare secvențială pe poziție — informativ, NU blochează bifarea (decizie Stefan
 * 2026-07-25). Primul pas e mereu 'available'. `allPriorCompleted` se acumulează cu AND
 * (nu se suprascrie cu doar rândul curent) — altfel un pas ANULAT la mijlocul unei secvențe deja
 * completate "deblochează" greșit tot ce urmează, pt. că verifica doar rândul imediat anterior,
 * nu ÎNTREG istoricul. Bug găsit de Stefan 2026-07-25: a anulat un pas din mijlocul Tier 1 și
 * Tier 2 a rămas greșit deblocat.
 */
export function computeStatus(goals: Row[]): (Row & { status: 'locked' | 'available' | 'completed' })[] {
  let allPriorCompleted = true
  return goals.map((g) => {
    const status: 'locked' | 'available' | 'completed' = g.completedAt
      ? 'completed'
      : allPriorCompleted
        ? 'available'
        : 'locked'
    allPriorCompleted = allPriorCompleted && g.completedAt !== null
    return { ...g, status }
  })
}

async function listByScope(me: SessionUser, scope: PlanScope) {
  return db
    .select()
    .from(planGoals)
    .where(and(eq(planGoals.scope, scope), isNull(planGoals.deletedAt), eq(planGoals.ownerUserId, me.id)))
    .orderBy(asc(planGoals.tier), asc(planGoals.position))
}

export async function getPlan(me: SessionUser) {
  const [personal, firma, mrr] = await Promise.all([listByScope(me, 'personal'), listByScope(me, 'firma'), getCurrentMrr()])
  return {
    personal: computeStatus(personal),
    firma: computeStatus(firma),
    mrrRon: mrr.mrrLei,
  }
}

export async function createGoal(me: SessionUser, input: CreateInput) {
  const [{ maxPosition } = { maxPosition: 0 }] = await db
    .select({ maxPosition: sql<number>`COALESCE(MAX(${planGoals.position}), 0)::int` })
    .from(planGoals)
    .where(and(eq(planGoals.scope, input.scope), eq(planGoals.tier, input.tier), isNull(planGoals.deletedAt), eq(planGoals.ownerUserId, me.id)))

  const [row] = await db
    .insert(planGoals)
    .values({
      ownerUserId: me.id,
      scope: input.scope,
      tier: input.tier,
      position: maxPosition + 1,
      title: input.title,
      note: input.note,
      thresholdType: input.thresholdType,
      thresholdValue: input.thresholdValue !== undefined ? String(input.thresholdValue) : undefined,
      monthlyCostRon: input.monthlyCostRon !== undefined ? String(input.monthlyCostRon) : undefined,
      targetPriceAmount: input.targetPriceAmount !== undefined ? String(input.targetPriceAmount) : undefined,
      targetPriceCurrency: input.targetPriceCurrency,
      targetDate: input.targetDate,
    })
    .returning()
  return row
}

export async function updateGoal(me: SessionUser, id: string, input: UpdateInput) {
  const [existing] = await db
    .select()
    .from(planGoals)
    .where(and(eq(planGoals.id, id), eq(planGoals.ownerUserId, me.id),
      isNull(planGoals.deletedAt)))
  if (!existing) return null

  const nextThresholdType = input.thresholdType ?? existing.thresholdType
  let thresholdValue: string | null
  if (nextThresholdType === 'manual') {
    thresholdValue = null
  } else {
    const resolved = input.thresholdValue !== undefined ? input.thresholdValue : existing.thresholdValue
    if (resolved === null || resolved === undefined) throw new ThresholdValueRequiredError()
    thresholdValue = String(resolved)
  }

  const monthlyCostRon =
    input.monthlyCostRon !== undefined
      ? input.monthlyCostRon === null
        ? null
        : String(input.monthlyCostRon)
      : undefined

  const targetPriceAmount =
    input.targetPriceAmount !== undefined
      ? input.targetPriceAmount === null
        ? null
        : String(input.targetPriceAmount)
      : undefined

  const [row] = await db
    .update(planGoals)
    .set({
      title: input.title,
      note: input.note,
      tier: input.tier,
      thresholdType: input.thresholdType,
      thresholdValue,
      monthlyCostRon,
      targetPriceAmount,
      targetPriceCurrency: input.targetPriceCurrency,
      targetDate: input.targetDate,
      updatedAt: new Date(),
    })
    .where(eq(planGoals.id, id))
    .returning()
  return row
}

export async function deleteGoal(me: SessionUser, id: string) {
  const [row] = await db
    .update(planGoals)
    .set({ deletedAt: new Date() })
    .where(and(eq(planGoals.id, id), eq(planGoals.ownerUserId, me.id),
      isNull(planGoals.deletedAt)))
    .returning()
  return row
}

export async function setCompleted(me: SessionUser, id: string, input: CompleteInput) {
  const [row] = await db
    .update(planGoals)
    .set({ completedAt: input.completed ? new Date() : null, updatedAt: new Date() })
    .where(and(eq(planGoals.id, id), eq(planGoals.ownerUserId, me.id),
      isNull(planGoals.deletedAt)))
    .returning()
  return row
}

/**
 * Rescrie pozițiile unui etaj (scope+tier) într-o tranzacție. Validează STRICT că orderedIds
 * corespunde exact goal-urilor existente din acel etaj (apără împotriva unui client cu stare
 * stale) — reorder-ul e limitat la un singur etaj, mutarea între etaje se face din update.
 */
export async function reorderGoals(me: SessionUser, scope: PlanScope, tier: number, orderedIds: string[]) {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: planGoals.id })
      .from(planGoals)
      .where(and(eq(planGoals.scope, scope), eq(planGoals.tier, tier), isNull(planGoals.deletedAt)))
    const existingIds = new Set(existing.map((r) => r.id))
    if (existingIds.size !== orderedIds.length || !orderedIds.every((id) => existingIds.has(id))) {
      throw new InvalidReorderError('orderedIds nu corespunde exact cu goal-urile existente din acest etaj')
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(planGoals)
        .set({ position: i + 1, updatedAt: new Date() })
        .where(eq(planGoals.id, orderedIds[i]!))
    }
    return tx
      .select()
      .from(planGoals)
      .where(and(eq(planGoals.scope, scope), eq(planGoals.tier, tier), isNull(planGoals.deletedAt)))
      .orderBy(asc(planGoals.position))
  })
}
