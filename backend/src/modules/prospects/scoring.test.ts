/**
 * Parity tests. The expected values come from an independent Python reimplementation of the
 * formulas in scoring.ts (not from the original Python script, which uses signals the
 * `prospects` schema does not collect; see the two adaptations described in scoring.ts). They
 * check that the TypeScript port computes the same tanh / weighted mean / gate / bands, with
 * and without a known founding year. The company names in the fixtures are invented.
 */
import { describe, expect, it } from 'vitest'
import parityBuc from './__fixtures__/parity-buc.json' with { type: 'json' }
import parityBrasov from './__fixtures__/parity-brasov.json' with { type: 'json' }
import { computeScore, priorityForScore, scoreBudget, scoreContact, scoreNeed, scoreTechReceptivity, viabilityGate } from './scoring.js'

const DEFAULT_WEIGHTS = { budgetWeight: 0.25, needWeight: 0.3, techWeight: 0.25, contactWeight: 0.2 }
const DEFAULT_THRESHOLDS = { hotThreshold: 65, warmThreshold: 50, nurtureThreshold: 35 }

interface Fixture {
  firma: string
  raw: {
    cifra: number | null
    profit: number | null
    venituri: number | null
    angajati: number | null
    capital: number | null
    datorii: number | null
    stocuri: number | null
    disponib: number | null
    creante: number | null
  }
  foundingYear: number | null
  hasWebsite: boolean
  hasPhone: boolean
  hasEmail: boolean
  hasContactName: boolean
  isActive: boolean | null
  hasAnyFinancialData: boolean
  expected: {
    scoreBudget: number | null
    scoreNeed: number | null
    scoreTech: number | null
    scoreContact: number
    gate: number
    scoreFinal: number
  }
}

const TOLERANCE = 0.5 // puncte, scară 0-100 — aceeași formulă, doar rotunjiri float

// Cifra de afaceri preferată peste venituri totale (fix 2026-07-29, oglindește import-service.ts).
function revenueOf(raw: Fixture['raw']): number | null {
  return raw.cifra && raw.cifra > 0 ? raw.cifra : raw.venituri
}

function runFixture(fx: Fixture) {
  const revenue = revenueOf(fx.raw)
  const budget = scoreBudget({ revenue, profit: fx.raw.profit, debt: fx.raw.datorii, equity: fx.raw.capital, cash: fx.raw.disponib })
  const need = scoreNeed({ employeeCount: fx.raw.angajati, revenue, inventory: fx.raw.stocuri, receivables: fx.raw.creante })
  const tech = scoreTechReceptivity({ foundingYear: fx.foundingYear, hasWebsite: fx.hasWebsite, hasRecentFinancials: fx.hasAnyFinancialData })
  const contact = scoreContact({ hasPhone: fx.hasPhone, hasEmail: fx.hasEmail, hasWebsite: fx.hasWebsite, hasContactName: fx.hasContactName })
  const gate = viabilityGate({ isActive: fx.isActive ?? undefined, equity: fx.raw.capital, hasAnyFinancialData: fx.hasAnyFinancialData })
  const final = computeScore(
    {
      revenue,
      profit: fx.raw.profit,
      debt: fx.raw.datorii,
      equity: fx.raw.capital,
      cash: fx.raw.disponib,
      receivables: fx.raw.creante,
      inventory: fx.raw.stocuri,
      employeeCount: fx.raw.angajati,
      foundingYear: fx.foundingYear,
      hasWebsite: fx.hasWebsite,
      hasPhone: fx.hasPhone,
      hasEmail: fx.hasEmail,
      hasContactName: fx.hasContactName,
      hasRecentFinancials: fx.hasAnyFinancialData,
      hasAnyFinancialData: fx.hasAnyFinancialData,
      isActive: fx.isActive ?? undefined,
    },
    DEFAULT_WEIGHTS,
  )
  return { budget, need, tech, contact, gate, final }
}

function expectParity(fx: Fixture) {
  const { budget, need, tech, contact, gate, final } = runFixture(fx)

  if (fx.expected.scoreBudget === null) expect(budget).toBeNull()
  else expect(Math.abs(budget! * 100 - fx.expected.scoreBudget)).toBeLessThan(TOLERANCE)

  if (fx.expected.scoreNeed === null) expect(need).toBeNull()
  else expect(Math.abs(need! * 100 - fx.expected.scoreNeed)).toBeLessThan(TOLERANCE)

  if (fx.expected.scoreTech === null) expect(tech).toBeNull()
  else expect(Math.abs(tech! * 100 - fx.expected.scoreTech)).toBeLessThan(TOLERANCE)

  expect(Math.abs(contact * 100 - fx.expected.scoreContact)).toBeLessThan(TOLERANCE)
  expect(gate).toBe(fx.expected.gate)
  expect(Math.abs(final - fx.expected.scoreFinal)).toBeLessThan(TOLERANCE)
}

describe('paritate scoring — date reale BUC 2024 (cu foundingYear)', () => {
  for (const fx of parityBuc as Fixture[]) {
    it(`${fx.firma}`, () => expectParity(fx))
  }
})

describe('paritate scoring — date reale Brasov (fără foundingYear)', () => {
  for (const fx of parityBrasov as Fixture[]) {
    it(`${fx.firma}`, () => expectParity(fx))
  }
})

describe('scoreNeed — sweet spot 4-20 angajați (validat pe teren, Brasov)', () => {
  it('penalizează sever sub 4 angajați chiar la CA mare', () => {
    const tiny = scoreNeed({ employeeCount: 2, revenue: 2_000_000, inventory: 0, receivables: 0 })
    const sweet = scoreNeed({ employeeCount: 10, revenue: 2_000_000, inventory: 0, receivables: 0 })
    expect(tiny!).toBeLessThan(sweet!)
  })

  it('penalizează enterprise (>100 angajați)', () => {
    const enterprise = scoreNeed({ employeeCount: 300, revenue: 10_000_000, inventory: 0, receivables: 0 })
    const sweet = scoreNeed({ employeeCount: 10, revenue: 10_000_000, inventory: 0, receivables: 0 })
    expect(enterprise!).toBeLessThan(sweet!)
  })
})

describe('viabilityGate', () => {
  it('SKIP forțat dacă firma nu e activă', () => {
    expect(viabilityGate({ isActive: false, equity: 100_000, hasAnyFinancialData: true })).toBe(0)
  })

  it('SKIP dacă nu are deloc date financiare', () => {
    expect(viabilityGate({ equity: null, hasAnyFinancialData: false })).toBe(0)
  })

  it('SKIP dacă equity < -500k', () => {
    expect(viabilityGate({ equity: -600_000, hasAnyFinancialData: true })).toBe(0)
  })

  it('0.5 dacă equity negativ dar > -500k', () => {
    expect(viabilityGate({ equity: -1000, hasAnyFinancialData: true })).toBe(0.5)
  })

  it('1 în cazul normal', () => {
    expect(viabilityGate({ equity: 50_000, hasAnyFinancialData: true })).toBe(1)
  })
})

describe('priorityForScore', () => {
  it('respectă pragurile default 65/50/35', () => {
    expect(priorityForScore(70, DEFAULT_THRESHOLDS)).toBe('HOT')
    expect(priorityForScore(55, DEFAULT_THRESHOLDS)).toBe('WARM')
    expect(priorityForScore(40, DEFAULT_THRESHOLDS)).toBe('NURTURE')
    expect(priorityForScore(10, DEFAULT_THRESHOLDS)).toBe('SKIP')
  })
})
