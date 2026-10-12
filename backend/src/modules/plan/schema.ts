import { z } from 'zod'

const PlanScope = z.enum(['personal', 'firma'])
const ThresholdType = z.enum(['manual', 'mrr_ron'])
const TargetPriceCurrency = z.enum(['RON', 'EUR'])

export const CreatePlanGoalSchema = z
  .object({
    scope: PlanScope,
    tier: z.number().int().min(1).max(4).default(1),
    title: z.string().trim().min(1).max(255),
    note: z.string().trim().max(2000).optional(),
    thresholdType: ThresholdType.default('manual'),
    thresholdValue: z.number().positive().optional(),
    monthlyCostRon: z.number().nonnegative().max(999999).optional(),
    targetPriceAmount: z.number().nonnegative().max(99999999).optional(),
    targetPriceCurrency: TargetPriceCurrency.optional(),
    targetDate: z.string().trim().min(1).optional(),
  })
  .refine((d) => d.thresholdType !== 'mrr_ron' || d.thresholdValue !== undefined, {
    message: 'thresholdValue obligatoriu pt. thresholdType=mrr_ron',
    path: ['thresholdValue'],
  })
  .refine((d) => (d.targetPriceAmount !== undefined) === (d.targetPriceCurrency !== undefined), {
    message: 'targetPriceAmount și targetPriceCurrency trebuie completate împreună',
    path: ['targetPriceCurrency'],
  })

export const UpdatePlanGoalSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    tier: z.number().int().min(1).max(4).optional(),
    thresholdType: ThresholdType.optional(),
    thresholdValue: z.number().positive().nullable().optional(),
    monthlyCostRon: z.number().nonnegative().max(999999).nullable().optional(),
    targetPriceAmount: z.number().nonnegative().max(99999999).nullable().optional(),
    targetPriceCurrency: TargetPriceCurrency.nullable().optional(),
    targetDate: z.string().trim().min(1).nullable().optional(),
  })
  .refine(
    (d) =>
      d.targetPriceAmount === undefined ||
      d.targetPriceCurrency === undefined ||
      (d.targetPriceAmount === null) === (d.targetPriceCurrency === null),
    { message: 'targetPriceAmount și targetPriceCurrency trebuie completate/golite împreună', path: ['targetPriceCurrency'] },
  )

export const CompleteGoalSchema = z.object({ completed: z.boolean() })

export const ReorderGoalsSchema = z.object({
  scope: PlanScope,
  tier: z.number().int().min(1).max(4),
  orderedIds: z.array(z.string().uuid()).min(1),
})
