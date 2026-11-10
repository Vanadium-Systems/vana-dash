/**
 * The configurable score (base + criteria) and the signals, on a real Postgres (test/setup.ts).
 * The score config is one row per company: the tests change it and put it back.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { auditLog, prospectScoringConfig, prospectSignalHits, prospects } from '../../shared/db/schema/index.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'
import { computeFinalScore, renderTalkingTip } from './scoring.js'
import * as scoreSignals from './score-signals-service.js'
import { getProspectSheet, getScoringConfig, listProspects, recalculateScores, updateScoringConfig } from './service.js'

const userIds: string[] = []
const prospectIds: string[] = []
const signalIds: string[] = []
const TAG = `QASS${Date.now()}`
const CAEN = `9${Math.floor(Math.random() * 9000) + 1000}`
const OTHER_CAEN = `8${Math.floor(Math.random() * 9000) + 1000}`

let manager: SessionUser
let agent: SessionUser
let original: Awaited<ReturnType<typeof getScoringConfig>>

const newProspect = async (name: string, values: Partial<typeof prospects.$inferInsert> = {}) => {
  const [row] = await db.insert(prospects).values({ name: `${TAG} ${name}`, scoreBase: '60', score: '60', ...values }).returning()
  prospectIds.push(row!.id)
  return row!.id
}
const scoreOf = async (id: string) => {
  const [row] = await db.select({ score: prospects.score }).from(prospects).where(eq(prospects.id, id))
  return Number(row!.score)
}
const setCriteria = (baseWeight: string, criteria: unknown[]) =>
  db.update(prospectScoringConfig).set({ baseWeight, criteria }).where(eq(prospectScoringConfig.id, original.id))
const criterion = (caen: string, points: number) => ({
  id: crypto.randomUUID(),
  name: `${TAG} ${caen}`,
  filters: [{ field: 'caen' as const, op: 'in' as const, value: [caen] }],
  points,
})
const builtin = async (key: string) => {
  const groups = await scoreSignals.listSignals()
  return groups.flatMap((g) => g.signals).find((s) => s.builtinKey === key)!
}
const hitsOf = (signalId: string, prospectId: string) =>
  db
    .select({ id: prospectSignalHits.id })
    .from(prospectSignalHits)
    .where(and(eq(prospectSignalHits.signalId, signalId), eq(prospectSignalHits.prospectId, prospectId)))

beforeAll(async () => {
  manager = await createTestUser('manager', userIds, { features: ['clienti.view', 'clienti.prospectare', 'clienti.toti', 'clienti.repartizare'] })
  agent = await createTestUser('agent', userIds, { features: ['clienti.view', 'clienti.prospectare'] })
  original = await getScoringConfig()
})

afterAll(async () => {
  await db
    .update(prospectScoringConfig)
    .set({
      hotThreshold: original.hotThreshold,
      warmThreshold: original.warmThreshold,
      nurtureThreshold: original.nurtureThreshold,
      baseWeight: original.baseWeight,
      criteria: original.criteria,
      labels: original.labels,
    })
    .where(eq(prospectScoringConfig.id, original.id))
  if (signalIds.length) await db.delete(prospectSignalHits).where(inArray(prospectSignalHits.signalId, signalIds))
  await db.delete(auditLog).where(and(eq(auditLog.action, 'prospect.scor.config'), eq(auditLog.entityId, original.id)))
  if (prospectIds.length) await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  await cleanupTestUsers(userIds)
})

describe('computeFinalScore', () => {
  const c = (id: string, points: number) => ({ id, points })

  it('is the base score as is without criteria, also with a zero base weight', () => {
    expect(computeFinalScore(73.4, [], { baseWeight: 1, criteria: [] })).toBe(73.4)
    expect(computeFinalScore(73.4, [], { baseWeight: 0, criteria: [] })).toBe(73.4)
  })

  it('counts only the matched criteria against the sum of all of them', () => {
    // 100 * (60 * 0.5 + 20) / (100 * 0.5 + 30)
    expect(computeFinalScore(60, ['a'], { baseWeight: 0.5, criteria: [c('a', 20), c('b', 10)] })).toBe(62.5)
  })

  it('keeps a zero base at zero whatever matches', () => {
    expect(computeFinalScore(0, ['a'], { baseWeight: 0.5, criteria: [c('a', 20)] })).toBe(0)
  })

  it('leaves the criteria alone when the base weight is zero', () => {
    expect(computeFinalScore(60, ['a'], { baseWeight: 0, criteria: [c('a', 20), c('b', 20)] })).toBe(50)
    expect(computeFinalScore(60, [], { baseWeight: 0, criteria: [c('a', 20)] })).toBe(0)
  })
})

describe('renderTalkingTip', () => {
  it('fills the four variables and leaves the growth empty when unknown', () => {
    const p = { name: 'Acme', caenCode: '3811', revenue: '125000', revenuePrev: '100000', employeeCount: 12 }
    expect(renderTalkingTip('{{firma}} / {{caen}} / {{crestere_ca}}% / {{angajati}}', p)).toBe('Acme / 3811 / 25% / 12')
    expect(renderTalkingTip('[{{crestere_ca}}]', { ...p, revenuePrev: null })).toBe('[]')
  })
})

describe('criteria in the database', () => {
  it('gives the expected score to a prospect that matches and one that does not', async () => {
    await setCriteria('0.50', [criterion(CAEN, 20), criterion(OTHER_CAEN, 10)])
    const match = await newProspect('match', { caenCode: CAEN })
    const miss = await newProspect('miss', { caenCode: '1111' })
    await scoreSignals.applyCriteria([match, miss])
    expect(await scoreOf(match)).toBe(62.5)
    // 100 * 30 / 80
    expect(await scoreOf(miss)).toBe(37.5)
  })

  it('keeps base 0 at 0 and applies signals and criteria to every prospect of a batch', async () => {
    const young = new Date().getFullYear() - 1
    await setCriteria('1.00', [criterion(CAEN, 20)])
    const a = await newProspect('batch-a', { caenCode: CAEN, foundingYear: young, isActive: false })
    const b = await newProspect('batch-b', { caenCode: CAEN, foundingYear: young, employeeCount: 10, revenue: '900000' })
    const c = await newProspect('batch-c', { caenCode: CAEN, foundingYear: young, employeeCount: 10, revenue: '900000' })
    await db.update(prospects).set({ scoreBase: '0', score: '0' }).where(eq(prospects.id, a))
    await scoreSignals.applyCriteria([a])
    expect(await scoreOf(a)).toBe(0)

    const newCompany = await builtin('new_company')
    await recalculateScores([b, c])
    for (const id of [b, c]) {
      expect(await hitsOf(newCompany.id, id)).toHaveLength(1)
      expect(await scoreOf(id)).toBeGreaterThan(0)
    }
    await setCriteria('1.00', [])
  })

  it('puts the base score back when the criteria are removed', async () => {
    const id = await newProspect('plain', { caenCode: CAEN })
    await setCriteria('1.00', [])
    await scoreSignals.applyCriteria([id])
    expect(await scoreOf(id)).toBe(60)
  })

  it('previews without writing and the distribution adds up to the total', async () => {
    await setCriteria('1.00', [])
    const id = await newProspect('preview', { caenCode: CAEN })
    const before = await scoreOf(id)
    const draft = { baseWeight: 0.5, criteria: [criterion(CAEN, 20)], labels: { excellent: 70, good: 50, fit: 30 } }
    const preview = await scoreSignals.previewScoring(draft)
    expect(await scoreOf(id)).toBe(before)
    expect(preview.distribution.map((d) => d.label)).toEqual(['excellent', 'good', 'fit', 'unfit'])
    expect(preview.distribution.reduce((sum, d) => sum + d.count, 0)).toBe(preview.total)
    // 100 * (60 * 0.5 + 20) / (50 + 20) = 71.4: our prospect is in the top label.
    expect(preview.distribution[0]!.count).toBeGreaterThanOrEqual(1)
  })

  it('writes the labels into the hot / warm / nurture cut-offs and audits the old config', async () => {
    await updateScoringConfig({
      budgetWeight: Number(original.budgetWeight),
      needWeight: Number(original.needWeight),
      techWeight: Number(original.techWeight),
      contactWeight: Number(original.contactWeight),
      hotThreshold: 10,
      warmThreshold: 5,
      nurtureThreshold: 1,
      labels: { excellent: 80, good: 60, fit: 40 },
    })
    const config = await getScoringConfig()
    expect([Number(config.hotThreshold), Number(config.warmThreshold), Number(config.nurtureThreshold)]).toEqual([80, 60, 40])
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.action, 'prospect.scor.config'), eq(auditLog.entityId, original.id)))
    expect(audit.length).toBeGreaterThanOrEqual(1)
  })

  it('refuses to change the score or the signals without clienti.repartizare', () => {
    expect(() => scoreSignals.assertCanConfigureScoring(agent)).toThrow(scoreSignals.ScoringForbiddenError)
    expect(() => scoreSignals.assertCanConfigureScoring(manager)).not.toThrow()
  })
})

describe('signals', () => {
  it('flags a company founded last year and one whose turnover grew 25%', async () => {
    const newCompany = await builtin('new_company')
    const growth = await builtin('revenue_growth')
    const young = await newProspect('young', { foundingYear: new Date().getFullYear() - 1 })
    const old = await newProspect('old', { foundingYear: 1998, revenue: '125000', revenuePrev: '100000' })
    const flat = await newProspect('flat', { foundingYear: 1998, revenue: '110000', revenuePrev: '100000' })
    await scoreSignals.recomputeSignals([young, old, flat])
    expect(await hitsOf(newCompany.id, young)).toHaveLength(1)
    expect(await hitsOf(newCompany.id, old)).toHaveLength(0)
    expect(await hitsOf(growth.id, old)).toHaveLength(1)
    expect(await hitsOf(growth.id, flat)).toHaveLength(0)
  })

  it('does not delete a built-in signal, and switching it off removes its hits', async () => {
    const signal = await builtin('new_company')
    await expect(scoreSignals.deleteSignal(signal.id)).rejects.toThrow(scoreSignals.SignalBuiltinError)

    const young = await newProspect('young-off', { foundingYear: new Date().getFullYear() })
    await scoreSignals.recomputeSignals([young])
    expect(await hitsOf(signal.id, young)).toHaveLength(1)
    await scoreSignals.updateSignal(signal.id, { enabled: false })
    expect(await hitsOf(signal.id, young)).toHaveLength(0)
    await scoreSignals.updateSignal(signal.id, { enabled: true })
    expect(await hitsOf(signal.id, young)).toHaveLength(1)
  })

  it('is found by the signal filter and shows on the sheet with the tip filled in', async () => {
    const created = await scoreSignals.createSignal({
      name: `${TAG} custom`,
      groupKey: 'company',
      talkingTip: 'Ask {{firma}} about {{angajati}} people',
      filters: [{ field: 'caen', op: 'in', value: [CAEN] }],
    })
    signalIds.push(created.id)
    const id = await newProspect('signalled', { caenCode: CAEN, employeeCount: 7 })
    await scoreSignals.recomputeSignals([id])

    const list = await listProspects(manager, { f: [{ field: 'signal', op: 'in', value: [created.id] }] })
    expect(list.rows.map((r) => r.id)).toContain(id)

    const sheet = await getProspectSheet(manager, id)
    expect(sheet?.signals.find((s) => s.id === created.id)?.talkingTip).toBe(`Ask ${TAG} signalled about 7 people`)

    const listed = (await scoreSignals.listSignals()).flatMap((g) => g.signals).find((s) => s.id === created.id)
    expect(listed?.hitCount).toBeGreaterThanOrEqual(1)
    expect(listed?.usedIn).toEqual({ score: false, views: 0 })

    expect(await scoreSignals.deleteSignal(created.id)).toBe(true)
    expect(await hitsOf(created.id, id)).toHaveLength(0)
  })
})
