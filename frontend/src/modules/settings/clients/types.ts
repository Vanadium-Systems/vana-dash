import type { FilterClause } from '@/shared/lib/filters'
import type { ProspectScoringConfig } from '@/shared/lib/types'

export interface ReleaseSettings {
  enabled: boolean
  idleDays: number
  warnDays: number
}

export const RULE_KEYS = ['reply_call_task', 'bounce_notify', 'no_next_step', 'meeting_stage', 'won_cleanup', 'import_list'] as const
export type RuleKey = (typeof RULE_KEYS)[number]

export interface AutomationRule {
  ruleKey: RuleKey
  enabled: boolean
  params: Record<string, unknown>
  lastRunAt: string | null
  lastRunCount: number | null
}

export interface ScoreCriterion {
  id: string
  name: string
  filters: FilterClause[]
  points: number
}

export interface ScoreLabels {
  excellent: number
  good: number
  fit: number
}

/** `GET /api/prospects/scoring-config`: the row, with the criteria and labels of the score. */
export interface ScoringConfigFull extends ProspectScoringConfig {
  baseWeight: string
  criteria: ScoreCriterion[]
  labels: ScoreLabels | null
}

export type ScoreLabelKey = 'excellent' | 'good' | 'fit' | 'unfit'

export interface ScoreDistribution {
  distribution: Array<{ label: ScoreLabelKey; count: number }>
  total: number
}

export const SIGNAL_GROUPS = ['company', 'activity', 'contact'] as const
export type SignalGroup = (typeof SIGNAL_GROUPS)[number]

export interface Signal {
  id: string
  name: string
  groupKey: SignalGroup
  description: string | null
  talkingTip: string | null
  filters: FilterClause[]
  enabled: boolean
  builtinKey: string | null
  hitCount: number
  usedIn: { score: boolean; views: number }
}

export interface SignalInput {
  name: string
  groupKey: SignalGroup
  description: string | null
  talkingTip: string | null
  filters: FilterClause[]
  enabled: boolean
}
