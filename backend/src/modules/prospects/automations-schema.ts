import { z } from 'zod'

export const RULE_KEYS = ['reply_call_task', 'bounce_notify', 'no_next_step', 'meeting_stage', 'won_cleanup', 'import_list'] as const
export type RuleKey = (typeof RULE_KEYS)[number]

// One schema per fixed rule; the defaults double as the parameters of a rule with no row yet.
export const RULE_PARAMS = {
  reply_call_task: z.object({ hour: z.number().int().min(0).max(23).default(10) }).strict(),
  bounce_notify: z.object({}).strict(),
  no_next_step: z.object({ days: z.number().int().min(1).max(90).default(7) }).strict(),
  meeting_stage: z.object({ status: z.string().trim().min(1).max(60).nullable().default(null) }).strict(),
  won_cleanup: z.object({}).strict(),
  import_list: z.object({ listId: z.string().uuid().nullable().default(null), minScore: z.number().min(0).max(100).default(65) }).strict(),
} as const satisfies Record<RuleKey, z.ZodTypeAny>

export type RuleParams<K extends RuleKey> = z.infer<(typeof RULE_PARAMS)[K]>

export const AutomationParamsSchema = z.object({ ruleKey: z.enum(RULE_KEYS) })
export const UpdateAutomationSchema = z.object({
  enabled: z.boolean(),
  params: z.record(z.string(), z.unknown()).default({}),
})
