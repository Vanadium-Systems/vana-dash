/**
 * What a research pass (by hand or by an agent such as Harvey) found about a company. Each field
 * is one of a fixed set of answers; `null` is "unknown", which no criterion should read as "no".
 * The score uses them only through the criteria in Settings.
 */
export const RESEARCH_FIELDS = {
  researchFines: ['yes', 'no'],
  researchNews: ['often', 'sometimes', 'rarely', 'never'],
  researchBadNews: ['yes', 'no'],
  researchGrowth: ['yes', 'no'],
  researchCompetitor: ['yes', 'no'],
} as const

export type ResearchField = keyof typeof RESEARCH_FIELDS
export const RESEARCH_FIELD_KEYS = Object.keys(RESEARCH_FIELDS) as ResearchField[]

/** The filter value that means "nobody checked": matches a `null` column. */
export const RESEARCH_UNKNOWN = 'unknown'
