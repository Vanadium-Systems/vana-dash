/**
 * Integration test — pg real (test/setup.ts). Acoperă upsert-ul idempotent pe
 * `(source, externalId)` (trucul `xmax = 0` care distinge insert de update în `RETURNING`) și
 * dismiss/undismiss.
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { tenderOpportunities } from '../../shared/db/schema/index.js'
import * as service from './service.js'
import type { NormalizedTenderRow } from './types.js'

const opportunityIds: string[] = []

afterAll(async () => {
  if (opportunityIds.length) await db.delete(tenderOpportunities).where(inArray(tenderOpportunities.id, opportunityIds))
})

type UpsertRow = NormalizedTenderRow & {
  matchedRuleId: string | null
  isPriority: boolean
  excludedByRule: boolean
  minTurnoverRon: number | null
  eligibilityNote: string | null
  ineligibleByTurnover: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS)

function makeRow(overrides: Partial<UpsertRow> = {}): UpsertRow {
  return {
    source: 'direct_acquisition',
    externalId: 'QA-DA-1',
    title: 'Servicii de dezvoltare software',
    cpvCode: '72000000-5',
    cpvDescription: 'Servicii IT',
    contractingAuthority: 'Primăria QA',
    estimatedValueRon: 10_000,
    procedureType: null,
    stateText: 'Ofertare',
    isOpen: true,
    publicationDate: new Date('2026-09-01T10:00:00Z'),
    deadlineAt: daysFromNow(20),
    detailUrl: 'https://www.e-licitatie.ro/pub/direct-acquisition/view/999',
    matchedRuleId: null,
    isPriority: false,
    excludedByRule: false,
    minTurnoverRon: null,
    eligibilityNote: null,
    ineligibleByTurnover: false,
    raw: { qa: true },
    ...overrides,
  }
}

describe('upsertTenderOpportunities', () => {
  it('insert nou pe (source, externalId) necunoscut', async () => {
    const { inserted, updated, rows } = await service.upsertTenderOpportunities([makeRow()])
    opportunityIds.push(...rows.map((r) => r.id))

    expect(inserted).toBe(1)
    expect(updated).toBe(0)
    expect(rows[0]?.inserted).toBe(true)
  })

  it('a doua oară pe același (source, externalId) e update, nu duplicat', async () => {
    const { inserted, updated, rows } = await service.upsertTenderOpportunities([makeRow({ estimatedValueRon: 20_000, stateText: 'Oferta acceptata' })])

    expect(inserted).toBe(0)
    expect(updated).toBe(1)
    expect(rows[0]?.inserted).toBe(false)
    expect(rows[0]?.id).toBe(opportunityIds[0])

    const [row] = await db.select().from(tenderOpportunities).where(eq(tenderOpportunities.id, opportunityIds[0]!))
    expect(row?.estimatedValueRon).toBe('20000.00')
    expect(row?.stateText).toBe('Oferta acceptata')
  })

  it('sursă + externalId diferite rămân rânduri separate', async () => {
    const { inserted, rows } = await service.upsertTenderOpportunities([makeRow({ source: 'contract_notice', externalId: 'QA-DA-1' })])
    opportunityIds.push(...rows.map((r) => r.id))

    expect(inserted).toBe(1)
    expect(rows[0]?.id).not.toBe(opportunityIds[0])
  })

  it('excludedByRule=true setează dismissedAt direct la inserare', async () => {
    const { rows } = await service.upsertTenderOpportunities([makeRow({ externalId: 'QA-EXCLUDE-1', excludedByRule: true })])
    opportunityIds.push(...rows.map((r) => r.id))

    expect(rows[0]?.dismissedAt).not.toBeNull()
    const listedDefault = await service.listTenderOpportunities({})
    expect(listedDefault.some((r) => r.id === rows[0]!.id)).toBe(false)
  })

  it('un rând deja restaurat manual nu e re-arhivat la un UPDATE cu excludedByRule=true', async () => {
    const { rows: firstRows } = await service.upsertTenderOpportunities([makeRow({ externalId: 'QA-EXCLUDE-2', excludedByRule: true })])
    opportunityIds.push(...firstRows.map((r) => r.id))
    await service.undismissTenderOpportunity(firstRows[0]!.id)

    const { rows: secondRows } = await service.upsertTenderOpportunities([makeRow({ externalId: 'QA-EXCLUDE-2', excludedByRule: true })])

    expect(secondRows[0]?.id).toBe(firstRows[0]!.id)
    const [row] = await db.select().from(tenderOpportunities).where(eq(tenderOpportunities.id, firstRows[0]!.id))
    expect(row?.dismissedAt).toBeNull()
  })

  it('ineligibleByTurnover=true setează dismissedAt direct la inserare și salvează minTurnoverRon/eligibilityNote', async () => {
    const { rows } = await service.upsertTenderOpportunities([
      makeRow({
        externalId: 'QA-INELIGIBLE-1',
        source: 'contract_notice',
        ineligibleByTurnover: true,
        minTurnoverRon: 2_700_000,
        eligibilityNote: 'CA min 2.700.000 lei',
      }),
    ])
    opportunityIds.push(...rows.map((r) => r.id))

    expect(rows[0]?.dismissedAt).not.toBeNull()
    const [row] = await db.select().from(tenderOpportunities).where(eq(tenderOpportunities.id, rows[0]!.id))
    expect(row?.minTurnoverRon).toBe('2700000.00')
    expect(row?.eligibilityNote).toBe('CA min 2.700.000 lei')
  })
})

describe('dismiss / undismiss', () => {
  it('dismiss setează dismissedAt, undismiss îl golește', async () => {
    const { rows } = await service.upsertTenderOpportunities([makeRow({ externalId: 'QA-DA-DISMISS' })])
    opportunityIds.push(...rows.map((r) => r.id))
    const id = rows[0]!.id

    const dismissed = await service.dismissTenderOpportunity(id)
    expect(dismissed?.dismissedAt).not.toBeNull()

    const listedDefault = await service.listTenderOpportunities({})
    expect(listedDefault.some((r) => r.id === id)).toBe(false)

    const listedArchived = await service.listTenderOpportunities({ dismissed: 'only' })
    expect(listedArchived.some((r) => r.id === id)).toBe(true)

    const undismissed = await service.undismissTenderOpportunity(id)
    expect(undismissed?.dismissedAt).toBeNull()
  })
})

describe('listTenderOpportunities — sortare prioritate', () => {
  it('rândurile isPriority=true ies în frunte, indiferent de deadline', async () => {
    const { rows: normalRows } = await service.upsertTenderOpportunities([
      makeRow({ externalId: 'QA-SORT-NORMAL', deadlineAt: daysFromNow(5), isPriority: false }),
    ])
    const { rows: priorityRows } = await service.upsertTenderOpportunities([
      makeRow({ externalId: 'QA-SORT-PRIORITY', deadlineAt: daysFromNow(60), isPriority: true }),
    ])
    opportunityIds.push(...normalRows.map((r) => r.id), ...priorityRows.map((r) => r.id))

    const listed = await service.listTenderOpportunities({})
    const priorityIdx = listed.findIndex((r) => r.id === priorityRows[0]!.id)
    const normalIdx = listed.findIndex((r) => r.id === normalRows[0]!.id)
    expect(priorityIdx).toBeGreaterThanOrEqual(0)
    expect(normalIdx).toBeGreaterThanOrEqual(0)
    expect(priorityIdx).toBeLessThan(normalIdx)
  })
})

describe('listTenderOpportunities — doar ce se mai poate depune', () => {
  it('scoate anunțurile închise și pe cele rămase „deschise" după termen; fără termen rămân', async () => {
    const { rows } = await service.upsertTenderOpportunities([
      makeRow({ externalId: 'QA-LIVE', deadlineAt: daysFromNow(3) }),
      makeRow({ externalId: 'QA-STALE-OPEN', deadlineAt: daysFromNow(-2), isOpen: true }),
      makeRow({ externalId: 'QA-CLOSED', deadlineAt: daysFromNow(3), isOpen: false }),
      makeRow({ externalId: 'QA-NO-DEADLINE', deadlineAt: null }),
    ])
    opportunityIds.push(...rows.map((r) => r.id))

    const listed = new Set((await service.listTenderOpportunities({})).map((r) => r.externalId))
    expect(listed.has('QA-LIVE')).toBe(true)
    expect(listed.has('QA-NO-DEADLINE')).toBe(true)
    expect(listed.has('QA-STALE-OPEN')).toBe(false)
    expect(listed.has('QA-CLOSED')).toBe(false)
  })
})
