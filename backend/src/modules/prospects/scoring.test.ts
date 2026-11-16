import { describe, expect, it } from 'vitest'
import {
  ageScore,
  capScore,
  computeFinalScore,
  computeScore,
  growthScore,
  isExcluded,
  priorityForScore,
  scoreBudget,
  scoreNeed,
  type ScoringInput,
} from './scoring.js'

const WEIGHTS = { budgetWeight: 0.25, needWeight: 0.3, techWeight: 0.25, contactWeight: 0.2 }
const THRESHOLDS = { hotThreshold: 65, warmThreshold: 50, nurtureThreshold: 35 }
const YEAR = new Date().getFullYear()

const healthy: ScoringInput = {
  revenue: 2_000_000,
  revenuePrev: 1_600_000,
  revenueYear: YEAR - 1,
  profit: 250_000,
  debt: 300_000,
  equity: 600_000,
  cash: 400_000,
  receivables: 300_000,
  inventory: 200_000,
  employeeCount: 12,
  foundingYear: YEAR - 6,
  hasWebsite: true,
  hasPhone: true,
  hasEmail: true,
  hasContactName: true,
  hasAnyFinancialData: true,
  isActive: true,
}

const finalLabel = (input: ScoringInput, matched: string[] = [], criteria: { id: string; points: number }[] = []) => {
  const base = computeScore(input, WEIGHTS)
  const final = computeFinalScore(base.score, matched, criteria)
  return priorityForScore(capScore(final, base.ceiling, THRESHOLDS), THRESHOLDS)
}

describe('scoreNeed', () => {
  it('ranks 4 to 20 employees above a tiny or a large company at the same turnover', () => {
    const at = (employeeCount: number) => scoreNeed({ employeeCount, revenue: 2_000_000, inventory: 0, receivables: 0 })!
    expect(at(2)).toBeLessThan(at(10))
    expect(at(300)).toBeLessThan(at(10))
  })

  it('leaves an unknown employee count out instead of reading it as zero', () => {
    const unknown = scoreNeed({ employeeCount: null, revenue: 2_000_000, inventory: null, receivables: null })!
    const zero = scoreNeed({ employeeCount: 0, revenue: 2_000_000, inventory: null, receivables: null })!
    expect(unknown).toBeGreaterThan(zero)
  })

  it('is null when nothing about the need is known', () => {
    expect(scoreNeed({ employeeCount: null, revenue: null, inventory: null, receivables: null })).toBeNull()
  })

  it('rewards growth over decline', () => {
    const base = { employeeCount: 10, revenue: 1_000_000, inventory: null, receivables: null }
    expect(scoreNeed({ ...base, revenuePrev: 700_000 })!).toBeGreaterThan(scoreNeed({ ...base, revenuePrev: 1_400_000 })!)
  })
})

describe('growthScore', () => {
  it('is neutral when flat and null without a previous year', () => {
    expect(growthScore(100, 100)).toBe(0.5)
    expect(growthScore(100, null)).toBeNull()
    expect(growthScore(100, 0)).toBeNull()
  })
})

describe('scoreBudget', () => {
  it('does not give full marks for zero debt when cash is unknown', () => {
    expect(scoreBudget({ revenue: null, profit: null, debt: 0, equity: null, cash: null })).toBeNull()
    expect(scoreBudget({ revenue: null, profit: null, debt: 0, equity: null, cash: 10_000 })).toBe(1)
  })
})

describe('ageScore', () => {
  it('treats impossible founding years as unknown', () => {
    expect(ageScore(0)).toBeNull()
    expect(ageScore(1800)).toBeNull()
    expect(ageScore(YEAR + 1)).toBeNull()
  })
})

describe('exclusion and ceiling', () => {
  it('excludes a struck-off company and one whose negative equity outweighs its turnover', () => {
    expect(isExcluded({ isActive: false, equity: 100_000, revenue: 1_000_000 })).toBe(true)
    expect(isExcluded({ equity: -600_000, revenue: 100_000 })).toBe(true)
    expect(isExcluded({ equity: -600_000, revenue: 5_000_000 })).toBe(false)
    expect(computeScore({ ...healthy, isActive: false }, WEIGHTS).score).toBe(0)
  })

  it('lets a healthy, well-known company be HOT', () => {
    expect(finalLabel(healthy)).toBe('HOT')
  })

  it('keeps a company without financial data at NURTURE at most, not SKIP by default', () => {
    const noData: ScoringInput = {
      ...healthy,
      revenue: null,
      revenuePrev: null,
      revenueYear: null,
      profit: null,
      debt: null,
      equity: null,
      cash: null,
      receivables: null,
      inventory: null,
      employeeCount: null,
      hasAnyFinancialData: false,
    }
    const result = computeScore(noData, WEIGHTS)
    expect(result.score).toBeGreaterThan(0)
    expect(result.ceiling).toBe('nurture')
    expect(finalLabel(noData)).toBe('NURTURE')
  })

  it('does not cap a profitable company only slightly under water', () => {
    const large = { ...healthy, revenue: 50_000_000, revenuePrev: 45_000_000, profit: 4_000_000, cash: 5_000_000, debt: 8_000_000, equity: -550_000 }
    expect(isExcluded(large)).toBe(false)
    expect(computeScore(large, WEIGHTS).ceiling).toBeNull()
  })

  it('moves the score a little, not off a cliff, between +1 and -1 RON of equity', () => {
    const plus = computeScore({ ...healthy, equity: 1 }, WEIGHTS).score
    const minus = computeScore({ ...healthy, equity: -1 }, WEIGHTS).score
    expect(Math.abs(plus - minus)).toBeLessThan(0.5)
  })

  it('never lets serious negative equity reach HOT, whatever the criteria', () => {
    const negative = { ...healthy, equity: -800_000 }
    const criteria = [{ id: 'a', points: 20 }]
    expect(computeScore(negative, WEIGHTS).ceiling).toBe('warm')
    expect(finalLabel(negative, ['a'], criteria)).not.toBe('HOT')
  })

  it('caps a company with under half the key fields known at WARM', () => {
    const thin = { ...healthy, profit: null, debt: null, equity: null, cash: null }
    expect(computeScore(thin, WEIGHTS).ceiling).toBe('warm')
  })
})

describe('dormant company', () => {
  it('keeps a filed balance sheet with no turnover and no employees at SKIP', () => {
    const dormant: ScoringInput = {
      ...healthy,
      revenue: 0,
      revenuePrev: null,
      profit: 0,
      debt: 0,
      equity: 200,
      cash: null,
      receivables: null,
      inventory: null,
      employeeCount: 0,
      foundingYear: YEAR - 1,
    }
    expect(computeScore(dormant, WEIGHTS).ceiling).toBe('skip')
    expect(finalLabel(dormant, ['a'], [{ id: 'a', points: 20 }])).toBe('SKIP')
  })
})

describe('priorityForScore', () => {
  it('follows the 65/50/35 defaults', () => {
    expect(priorityForScore(70, THRESHOLDS)).toBe('HOT')
    expect(priorityForScore(55, THRESHOLDS)).toBe('WARM')
    expect(priorityForScore(40, THRESHOLDS)).toBe('NURTURE')
    expect(priorityForScore(10, THRESHOLDS)).toBe('SKIP')
  })
})
