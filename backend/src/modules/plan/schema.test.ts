/**
 * modules/plan/schema.ts — CreatePlanGoalSchema.refine: thresholdValue e obligatoriu doar
 * când thresholdType='mrr_ron', altfel un goal 'manual' cu prag rămâne fără sens la calculul
 * progressPct pe frontend.
 */
import { describe, expect, it } from 'vitest'
import { CreatePlanGoalSchema, ReorderGoalsSchema } from './schema.js'

describe('CreatePlanGoalSchema', () => {
  it('acceptă thresholdType=manual fără thresholdValue', () => {
    const result = CreatePlanGoalSchema.safeParse({ scope: 'personal', title: 'Fă X' })
    expect(result.success).toBe(true)
  })

  it('respinge thresholdType=mrr_ron fără thresholdValue', () => {
    const result = CreatePlanGoalSchema.safeParse({ scope: 'firma', title: 'Angajează contabil', thresholdType: 'mrr_ron' })
    expect(result.success).toBe(false)
  })

  it('acceptă thresholdType=mrr_ron cu thresholdValue pozitiv', () => {
    const result = CreatePlanGoalSchema.safeParse({
      scope: 'firma',
      title: 'Angajează contabil',
      thresholdType: 'mrr_ron',
      thresholdValue: 10000,
    })
    expect(result.success).toBe(true)
  })

  it('respinge un scope invalid', () => {
    const result = CreatePlanGoalSchema.safeParse({ scope: 'altceva', title: 'X' })
    expect(result.success).toBe(false)
  })

  it('respinge title gol', () => {
    const result = CreatePlanGoalSchema.safeParse({ scope: 'personal', title: '' })
    expect(result.success).toBe(false)
  })

  it('tier default 1 dacă lipsește', () => {
    const result = CreatePlanGoalSchema.safeParse({ scope: 'firma', title: 'X' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.tier).toBe(1)
  })

  it('respinge tier peste 4', () => {
    const result = CreatePlanGoalSchema.safeParse({ scope: 'firma', title: 'X', tier: 5 })
    expect(result.success).toBe(false)
  })

  it('acceptă monthlyCostRon nenegativ', () => {
    const result = CreatePlanGoalSchema.safeParse({ scope: 'firma', title: 'X', tier: 2, monthlyCostRon: 1500 })
    expect(result.success).toBe(true)
  })

  it('respinge monthlyCostRon negativ', () => {
    const result = CreatePlanGoalSchema.safeParse({ scope: 'firma', title: 'X', monthlyCostRon: -1 })
    expect(result.success).toBe(false)
  })
})

describe('ReorderGoalsSchema', () => {
  it('acceptă un payload valid cu tier', () => {
    const result = ReorderGoalsSchema.safeParse({
      scope: 'personal',
      tier: 1,
      orderedIds: ['550e8400-e29b-41d4-a716-446655440000'],
    })
    expect(result.success).toBe(true)
  })

  it('respinge orderedIds gol', () => {
    const result = ReorderGoalsSchema.safeParse({ scope: 'personal', tier: 1, orderedIds: [] })
    expect(result.success).toBe(false)
  })

  it('respinge id-uri care nu sunt uuid', () => {
    const result = ReorderGoalsSchema.safeParse({ scope: 'personal', tier: 1, orderedIds: ['not-a-uuid'] })
    expect(result.success).toBe(false)
  })

  it('respinge lipsa tier-ului', () => {
    const result = ReorderGoalsSchema.safeParse({
      scope: 'personal',
      orderedIds: ['550e8400-e29b-41d4-a716-446655440000'],
    })
    expect(result.success).toBe(false)
  })

  it('respinge tier peste 4', () => {
    const result = ReorderGoalsSchema.safeParse({
      scope: 'personal',
      tier: 5,
      orderedIds: ['550e8400-e29b-41d4-a716-446655440000'],
    })
    expect(result.success).toBe(false)
  })
})
