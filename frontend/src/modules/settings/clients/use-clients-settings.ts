import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/lib/api'
import type { AutomationRule, ReleaseSettings, RuleKey, ScoreCriterion, ScoreDistribution, ScoreLabels, ScoringConfigFull, Signal, SignalGroup, SignalInput } from './types'

export function useReleaseSettings() {
  return useQuery({ queryKey: ['prospects', 'release-settings'], queryFn: () => api.get<ReleaseSettings>('/api/prospects/release-settings') })
}

export function useSaveReleaseSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ReleaseSettings) => api.put<ReleaseSettings>('/api/prospects/release-settings', input),
    onSuccess: (saved) => queryClient.setQueryData(['prospects', 'release-settings'], saved),
  })
}

export function useAutomations() {
  return useQuery({ queryKey: ['prospects', 'automations'], queryFn: () => api.get<AutomationRule[]>('/api/prospects/automations') })
}

export function useSaveAutomation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { ruleKey: RuleKey; enabled: boolean; params: Record<string, unknown> }) =>
      api.put<AutomationRule>(`/api/prospects/automations/${input.ruleKey}`, { enabled: input.enabled, params: input.params }),
    onSuccess: (saved) => queryClient.setQueryData<AutomationRule[]>(['prospects', 'automations'], (rules) => rules?.map((rule) => (rule.ruleKey === saved.ruleKey ? saved : rule))),
  })
}

export function useScoringConfig() {
  return useQuery({ queryKey: ['prospects', 'scoring-config'], queryFn: () => api.get<ScoringConfigFull>('/api/prospects/scoring-config') })
}

export interface ScoreDraft {
  baseWeight: number
  criteria: ScoreCriterion[]
  labels: ScoreLabels
}

export function useScoringPreview(draft: ScoreDraft | null) {
  return useQuery({
    queryKey: ['prospects', 'scoring-preview', draft],
    queryFn: () => api.post<ScoreDistribution>('/api/prospects/scoring/preview', draft),
    enabled: draft !== null,
    placeholderData: (previous) => previous,
  })
}

export function useSaveScoring() {
  const queryClient = useQueryClient()
  return useMutation({
    // The four sub-score weights are not editable here; they go back unchanged because the route requires them.
    mutationFn: ({ config, draft }: { config: ScoringConfigFull; draft: ScoreDraft }) =>
      api.put<{ recalculated: number }>('/api/prospects/scoring-config', {
        budgetWeight: Number(config.budgetWeight),
        needWeight: Number(config.needWeight),
        techWeight: Number(config.techWeight),
        contactWeight: Number(config.contactWeight),
        hotThreshold: draft.labels.excellent,
        warmThreshold: draft.labels.good,
        nurtureThreshold: draft.labels.fit,
        baseWeight: draft.baseWeight,
        criteria: draft.criteria,
        labels: draft.labels,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['prospects'] }),
  })
}

export function useSignals() {
  return useQuery({ queryKey: ['prospects', 'signals'], queryFn: () => api.get<Array<{ groupKey: SignalGroup; signals: Signal[] }>>('/api/prospects/signals') })
}

export function useSignalActions() {
  const queryClient = useQueryClient()
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['prospects', 'signals'] })
  return {
    create: useMutation({ mutationFn: (input: SignalInput) => api.post<Signal>('/api/prospects/signals', input), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, ...input }: Partial<SignalInput> & { id: string }) => api.patch<Signal>(`/api/prospects/signals/${id}`, input), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: string) => api.delete<void>(`/api/prospects/signals/${id}`), onSuccess: refresh }),
  }
}
