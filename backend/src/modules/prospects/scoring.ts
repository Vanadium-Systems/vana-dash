/**
 * Port 1:1 dintr-un script Python intern de scoring (v2, cold outreach).
 * Funcții pure, fără dependență DB — testabile izolat (test de paritate în scoring.test.ts).
 *
 * Două adaptări față de Python, impuse de schema `prospects` aprobată (PLAN.md):
 * - Python calculează equity ca `capital / (active imobilizate + active circulante)`; schema nu
 *   colectează activele — folosim `equity / revenue` ca proxy de scară (același tanh scale 0.35).
 * - Python alege "recency" din care an de bilanț a găsit date (4 trepte); schema nu ține anul
 *   exact al bilanțului — colapsat la un boolean `hasRecentFinancials` (are/nu are date
 *   financiare deloc), calculat de caller.
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
  if (foundingYear === null || foundingYear === undefined) return null
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
  } else if (debt === 0) {
    cashRatio = 1.0
  }

  let equityScore: number | null = null
  if (equity !== null && revenue !== null && revenue > 0) {
    equityScore = norm01(tanh(equity / revenue, 0.35))
  }
  if (equity !== null && equity < 0) {
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
  inventory: number | null
  receivables: number | null
}

/**
 * The sweet spot, checked against one county's outreach results, is 4 to 20 employees. Below 4
 * the answer is "we are too small" even at a high turnover. Above 60 you do not reach the
 * person who decides.
 */
export function scoreNeed(input: NeedInput): number | null {
  const ang = input.employeeCount ?? 0
  const venit = input.revenue && input.revenue > 0 ? input.revenue : 0

  let sizeScore: number
  if (ang <= 0) sizeScore = 0.05
  else if (ang <= 3) sizeScore = 0.2
  else if (ang <= 7) sizeScore = 0.8
  else if (ang <= 20) sizeScore = 1.0
  else if (ang <= 40) sizeScore = 0.75
  else if (ang <= 60) sizeScore = 0.4
  else if (ang <= 100) sizeScore = 0.15
  else sizeScore = 0.05

  let complexity: number | null = null
  if (venit > 0) {
    const stocRatio = (input.inventory ?? 0) / venit
    const creanRatio = (input.receivables ?? 0) / venit
    complexity = norm01(tanh(stocRatio + creanRatio, 0.3))
  }

  const cifraScore = venit > 0 ? norm01(tanh(venit / 1_500_000, 1.0)) : 0.0

  return wmean([
    [sizeScore, 0.5],
    [cifraScore, 0.25],
    [complexity, 0.25],
  ])
}

export interface TechInput {
  foundingYear: number | null
  hasWebsite: boolean
  hasRecentFinancials: boolean
}

export function scoreTechReceptivity(input: TechInput): number | null {
  const newnessScore = ageScore(input.foundingYear)
  const siteScore = input.hasWebsite ? 1.0 : 0.2
  const recencyScore = input.hasRecentFinancials ? 1.0 : 0.4

  return wmean([
    [newnessScore, 0.5],
    [siteScore, 0.25],
    [recencyScore, 0.25],
  ])
}

export interface ContactInput {
  hasPhone: boolean
  hasEmail: boolean
  hasWebsite: boolean
  hasContactName: boolean
}

export function scoreContact(input: ContactInput): number {
  let s = 0
  if (input.hasPhone) s += 0.4
  if (input.hasEmail) s += 0.25
  if (input.hasWebsite) s += 0.2
  if (input.hasContactName) s += 0.15
  return s
}

export interface GateInput {
  isActive?: boolean
  equity: number | null
  hasAnyFinancialData: boolean
}

/** 0 = SKIP forțat, 0.5 = capital negativ (viabil dar șubred), 1 = OK. */
export function viabilityGate(input: GateInput): 0 | 0.5 | 1 {
  if (input.isActive === false) return 0
  if (input.equity !== null && input.equity < -500_000) return 0
  if (!input.hasAnyFinancialData) return 0
  if (input.equity !== null && input.equity < 0) return 0.5
  return 1
}

export interface ScoringWeights {
  budgetWeight: number
  needWeight: number
  techWeight: number
  contactWeight: number
}

export interface ScoringThresholds {
  hotThreshold: number
  warmThreshold: number
  nurtureThreshold: number
}

export interface ScoringInput extends BudgetInput, NeedInput {
  foundingYear: number | null
  hasWebsite: boolean
  hasPhone: boolean
  hasEmail: boolean
  hasContactName: boolean
  hasRecentFinancials: boolean
  hasAnyFinancialData: boolean
  isActive?: boolean
}

/** Combină cele 4 sub-scoruri cu ponderile din config, înmulțește cu gate, clamp [0,100]. */
export function computeScore(input: ScoringInput, weights: ScoringWeights): number {
  const gate = viabilityGate({ isActive: input.isActive, equity: input.equity, hasAnyFinancialData: input.hasAnyFinancialData })
  if (gate === 0) return 0

  const budgetS = scoreBudget(input)
  const needS = scoreNeed(input)
  const techS = scoreTechReceptivity(input)
  const contactS = scoreContact(input)

  const composite = wmean([
    [budgetS, weights.budgetWeight],
    [needS, weights.needWeight],
    [techS, weights.techWeight],
    [contactS, weights.contactWeight],
  ])
  if (composite === null) return 0

  return Math.round(clamp(composite * gate * 100, 0, 100) * 10) / 10
}

export type Priority = 'HOT' | 'WARM' | 'NURTURE' | 'SKIP'

export function priorityForScore(score: number, thresholds: ScoringThresholds): Priority {
  if (score >= thresholds.hotThreshold) return 'HOT'
  if (score >= thresholds.warmThreshold) return 'WARM'
  if (score >= thresholds.nurtureThreshold) return 'NURTURE'
  return 'SKIP'
}
