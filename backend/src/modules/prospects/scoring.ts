/**
 * Prospect scoring (v3). Started as a port of an internal Python script; v3 changes the rules
 * on missing data:
 * - an unknown value is left out of its weighted mean (`null`), never read as zero;
 * - missing financials or a negative equity no longer zero or halve the score: they set a
 *   ceiling (`ScoreCeiling`) that keeps the company out of the top labels until the data is
 *   there, applied after the criteria so points cannot lift it past.
 * `equity / revenue` stands in for equity / total assets, which the schema does not collect.
 */

const CURRENT_YEAR = new Date().getFullYear()

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

export function tanh(x: number, scale = 1): number {
  return Math.tanh(x / scale)
}

function norm01(signed: number | null): number | null {
  return signed === null ? null : (signed + 1) / 2
}

function wmean(items: Array<[number | null, number]>): number | null {
  const known = items.filter((i): i is [number, number] => i[0] !== null)
  if (!known.length) return null
  const totalWeight = known.reduce((s, [, w]) => s + w, 0)
  if (totalWeight <= 0) return null
  return known.reduce((s, [v, w]) => s + v * w, 0) / totalWeight
}

/**
 * Firmă mai nouă = mai deschisă la risc/schimbare. Validat pe Brasov: CUI median firme pozitive
 * ~23% mai mare decât cele respinse. Bands identice cu Python.
 */
export function ageScore(foundingYear: number | null | undefined): number | null {
  // 0, 1800 or a future year is an import error, not a company age.
  if (foundingYear === null || foundingYear === undefined || foundingYear < 1900 || foundingYear > CURRENT_YEAR) return null
  const age = CURRENT_YEAR - foundingYear
  if (age <= 4) return 1.0
  if (age <= 8) return 0.85
  if (age <= 15) return 0.65
  if (age <= 25) return 0.4
  return 0.2
}

export interface BudgetInput {
  revenue: number | null
  profit: number | null
  debt: number | null
  equity: number | null
  cash: number | null
}

export function scoreBudget(input: BudgetInput): number | null {
  const { revenue, profit, debt, equity, cash } = input

  let marja: number | null = null
  if (revenue !== null && revenue > 0 && profit !== null) {
    marja = norm01(tanh(profit / revenue, 0.12))
  }

  let cashRatio: number | null = null
  if (debt !== null && debt > 0 && cash !== null) {
    cashRatio = norm01(tanh(cash / debt, 0.5))
  } else if (debt === 0 && cash !== null) {
    // A balance sheet with cash and no debt; debt 0 alone is also what an empty row looks like.
    cashRatio = 1.0
  }

  // Signed against turnover, so -1 and +1 RON score almost the same; without a turnover a
  // negative equity is all we know, and it scores 0.
  let equityScore: number | null = null
  if (equity !== null && revenue !== null && revenue > 0) {
    equityScore = norm01(tanh(equity / revenue, 0.35))
  } else if (equity !== null && equity < 0) {
    equityScore = 0.0
  }

  return wmean([
    [marja, 0.35],
    [cashRatio, 0.35],
    [equityScore, 0.3],
  ])
}

export interface NeedInput {
  employeeCount: number | null
  revenue: number | null
  revenuePrev?: number | null
  inventory: number | null
  receivables: number | null
}

/**
 * Log scale, 0 at 100,000 and 1 at 10,000,000. The old `tanh(revenue / 1.5M)` gave 0.82 to 1.0 to
 * nine companies in ten of the prospect list (median 2.4M), so turnover told them apart by
 * almost nothing.
 */
export function turnoverScore(revenue: number): number {
  if (revenue <= 0) return 0
  return clamp((Math.log10(revenue) - 5) / 2, 0, 1)
}

/** Turnover growth year on year: +20% → 0.76, flat → 0.5, -20% → 0.24. */
export function growthScore(revenue: number | null, revenuePrev: number | null | undefined): number | null {
  if (revenue === null || revenuePrev === null || revenuePrev === undefined || revenuePrev <= 0 || revenue < 0) return null
  return norm01(tanh(revenue / revenuePrev - 1, 0.2))
}

export interface SizeRange {
  min: number
  max: number
}

/** The range VanaGreen's recycling companies were checked against: 4 to 20 employees. */
export const DEFAULT_SIZE_RANGE: SizeRange = { min: 4, max: 20 }

/**
 * The bands checked on one county's outreach, scaled to the configured range. Below the bottom
 * stays a flat 0.2 on purpose: under 4 employees the answer was "we are too small" whatever the
 * turnover, so it is not smoothed away. From the bottom to twice the bottom it climbs from 0.8 to
 * 1; above the top it falls as a multiple of the top (twice 0.75, three times 0.4, five times 0.15).
 */
export function sizeScore(employees: number, range: SizeRange): number {
  if (employees <= 0) return 0.05
  if (employees < range.min) return 0.2
  if (employees <= range.max) return Math.min(1, 0.8 + (0.2 * (employees - range.min)) / range.min)
  const r = employees / range.max
  const points: Array<[number, number]> = [[1, 1], [2, 0.75], [3, 0.4], [5, 0.15]]
  for (let i = 1; i < points.length; i++) {
    const [r0, s0] = points[i - 1]!
    const [r1, s1] = points[i]!
    if (r <= r1) return s0 + ((s1 - s0) * (r - r0)) / (r1 - r0)
  }
  return 0.05
}

export function scoreNeed(input: NeedInput, range: SizeRange = DEFAULT_SIZE_RANGE): number | null {
  const sizeScoreValue = input.employeeCount === null ? null : sizeScore(input.employeeCount, range)

  const venit = input.revenue
  let cifraScore: number | null = null
  if (venit !== null) cifraScore = turnoverScore(venit)

  let complexity: number | null = null
  if (venit !== null && venit > 0 && (input.inventory !== null || input.receivables !== null)) {
    complexity = norm01(tanh(((input.inventory ?? 0) + (input.receivables ?? 0)) / venit, 0.3))
  }

  return wmean([
    [sizeScoreValue, 0.45],
    [cifraScore, 0.2],
    [complexity, 0.2],
    [growthScore(venit, input.revenuePrev), 0.15],
  ])
}

export interface TechInput {
  foundingYear: number | null
  hasWebsite: boolean
  revenueYear?: number | null
}

/** A balance sheet for year Y is filed in Y+1, so one year behind is as fresh as it gets. */
export function recencyScore(revenueYear: number | null | undefined): number | null {
  if (revenueYear === null || revenueYear === undefined) return null
  const age = CURRENT_YEAR - revenueYear
  if (age <= 1) return 1.0
  if (age <= 2) return 0.7
  if (age <= 3) return 0.4
  return 0.2
}

export function scoreTechReceptivity(input: TechInput): number | null {
  return wmean([
    [ageScore(input.foundingYear), 0.4],
    [input.hasWebsite ? 1.0 : 0.2, 0.35],
    [recencyScore(input.revenueYear), 0.25],
  ])
}

export interface GateInput {
  isActive?: boolean
  equity: number | null
  revenue: number | null
}

/**
 * The only hard exclusions: struck off, or equity so negative it outweighs a year of turnover
 * (and at least 500,000). Everything else lowers the score or caps it, it does not zero it.
 */
export function isExcluded(input: GateInput): boolean {
  if (input.isActive === false) return true
  const { equity, revenue } = input
  return equity !== null && equity < -Math.max(500_000, revenue ?? 0)
}

/**
 * The highest label a company can reach on what we know. `skip`: a filed balance sheet with no
 * turnover and no employees, a dormant company. `nurture`: no financial data at all,
 * so it needs research before anyone calls it a target. `warm`: serious negative equity, or too little
 * known about it (under two of turnover, profit and employees).
 */
export type ScoreCeiling = 'warm' | 'nurture' | 'skip' | null

export interface CeilingInput {
  dormant: boolean
  hasAnyFinancialData: boolean
  equity: number | null
  revenue: number | null
  profit: number | null
  coverage: number
}

/**
 * Negative equity matters when it is deep for the company's size or it is still losing money;
 * a profitable company 1% under water is not a risk worth capping.
 */
function seriousNegativeEquity(equity: number | null, revenue: number | null, profit: number | null): boolean {
  if (equity === null || equity >= 0) return false
  if (profit === null || profit <= 0) return true
  return -equity > 0.1 * Math.max(revenue ?? 0, 250_000)
}

export function scoreCeiling(input: CeilingInput): ScoreCeiling {
  if (input.dormant) return 'skip'
  if (!input.hasAnyFinancialData) return 'nurture'
  if (seriousNegativeEquity(input.equity, input.revenue, input.profit) || input.coverage < 0.5) return 'warm'
  return null
}

/**
 * Share of turnover, profit and employees that is known, 0..1. Only these three: the lists we
 * import carry them and almost never debt, equity or cash, so counting those would cap everyone.
 */
export function dataCoverage(input: Pick<ScoringInput, 'revenue' | 'profit' | 'employeeCount'>): number {
  const fields = [input.revenue, input.profit, input.employeeCount]
  return fields.filter((v) => v !== null && v !== undefined).length / fields.length
}

/** The score with its ceiling applied: one point below the label it may not reach. */
export function capScore(score: number, ceiling: ScoreCeiling, thresholds: ScoringThresholds): number {
  if (ceiling === 'skip') return Math.min(score, thresholds.nurtureThreshold - 0.1)
  if (ceiling === 'nurture') return Math.min(score, thresholds.warmThreshold - 0.1)
  if (ceiling === 'warm') return Math.min(score, thresholds.hotThreshold - 0.1)
  return score
}

export interface ScoringWeights {
  budgetWeight: number
  needWeight: number
  techWeight: number
  idealEmployees?: SizeRange
}

export interface ScoringThresholds {
  hotThreshold: number
  warmThreshold: number
  nurtureThreshold: number
}

export interface ScoringInput extends BudgetInput, NeedInput {
  foundingYear: number | null
  hasWebsite: boolean
  revenueYear?: number | null
  hasAnyFinancialData: boolean
  isActive?: boolean
}

export interface ScoreResult {
  /** 0..100, before criteria and before the ceiling. */
  score: number
  ceiling: ScoreCeiling
}

/**
 * How well the company fits: budget, need and tech receptivity, 0..100. Whether we can reach it
 * (phone, email) is left out on purpose: a good fit without a phone is a company to research,
 * not a worse company. The list filters it with "Contact".
 */
export function computeScore(input: ScoringInput, weights: ScoringWeights): ScoreResult {
  if (isExcluded({ isActive: input.isActive, equity: input.equity, revenue: input.revenue })) return { score: 0, ceiling: null }

  const composite = wmean([
    [scoreBudget(input), weights.budgetWeight],
    [scoreNeed(input, weights.idealEmployees), weights.needWeight],
    [scoreTechReceptivity(input), weights.techWeight],
  ])
  // All three weights at 0 (the config refuses it, older rows may not).
  if (composite === null) return { score: 0, ceiling: null }

  return {
    score: Math.round(clamp(composite * 100, 0, 100) * 10) / 10,
    ceiling: scoreCeiling({
      dormant: input.revenueYear != null && (input.revenue ?? 0) <= 0 && !(input.employeeCount && input.employeeCount > 0),
      hasAnyFinancialData: input.hasAnyFinancialData,
      equity: input.equity,
      revenue: input.revenue,
      profit: input.profit,
      coverage: dataCoverage(input),
    }),
  }
}

export type Priority = 'HOT' | 'WARM' | 'NURTURE' | 'SKIP'

export function priorityForScore(score: number, thresholds: ScoringThresholds): Priority {
  if (score >= thresholds.hotThreshold) return 'HOT'
  if (score >= thresholds.warmThreshold) return 'WARM'
  if (score >= thresholds.nurtureThreshold) return 'NURTURE'
  return 'SKIP'
}

export interface ScoreCriterion {
  id: string
  points: number
}

/**
 * Final score = the base score plus the points of the matched criteria, clamped to 0..100.
 * Additive on purpose: adding a criterion must not lower the companies that do not match it.
 */
export function computeFinalScore(base: number, matched: string[], criteria: ScoreCriterion[]): number {
  // An excluded company (base 0: struck off) does not become a target through criteria. The
  // ceiling is applied after this, by `capScore`, so criteria cannot lift past it either.
  if (base === 0) return 0
  const matchedSet = new Set(matched)
  const points = criteria.filter((c) => matchedSet.has(c.id)).reduce((sum, c) => sum + c.points, 0)
  return Math.round(clamp(base + points, 0, 100) * 10) / 10
}

/** `{{firma}}`, `{{caen}}`, `{{crestere_ca}}` (turnover growth in %, empty when unknown), `{{angajati}}`. */
export function renderTalkingTip(
  tip: string,
  prospect: { name: string; caenCode: string | null; revenue: string | null; revenuePrev: string | null; employeeCount: number | null },
): string {
  const revenue = Number(prospect.revenue)
  const previous = Number(prospect.revenuePrev)
  const growth = revenue > 0 && previous > 0 ? String(Math.round((revenue / previous - 1) * 100)) : ''
  const values: Record<string, string> = {
    firma: prospect.name,
    caen: prospect.caenCode ?? '',
    crestere_ca: growth,
    angajati: prospect.employeeCount === null ? '' : String(prospect.employeeCount),
  }
  return tip.replace(/\{\{(firma|caen|crestere_ca|angajati)\}\}/g, (_, name: string) => values[name] ?? '')
}
