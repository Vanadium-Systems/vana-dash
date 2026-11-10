import { z } from 'zod'
import { ProspectFiltersSchema } from './filters.js'
import { ScoreCriterionSchema, ScoreLabelsSchema } from './schema.js'

export const SIGNAL_GROUPS = ['company', 'activity', 'contact'] as const

// A draft of the score config to preview: whatever is left out is read from the saved config.
export const ScoringPreviewSchema = z.object({
  baseWeight: z.number().min(0).max(1).optional(),
  criteria: z.array(ScoreCriterionSchema).max(30).optional(),
  labels: ScoreLabelsSchema.nullable().optional(),
})

const signalFields = {
  name: z.string().trim().min(1).max(120),
  groupKey: z.enum(SIGNAL_GROUPS),
  description: z.string().trim().max(500).nullable(),
  talkingTip: z.string().trim().max(1000).nullable(),
  enabled: z.boolean(),
}

export const CreateSignalSchema = z.object({
  ...signalFields,
  description: signalFields.description.optional(),
  talkingTip: signalFields.talkingTip.optional(),
  enabled: signalFields.enabled.optional(),
  filters: ProspectFiltersSchema.min(1),
})

export const UpdateSignalSchema = z.object({ ...signalFields, filters: ProspectFiltersSchema }).partial()

export const SignalParamsSchema = z.object({ id: z.string().uuid() })
