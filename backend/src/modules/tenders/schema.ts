import { z } from 'zod'
import { lazyTr } from '../../shared/lib/i18n.js'

export const ListTendersQuerySchema = z.object({
  source: z.enum(['direct_acquisition', 'contract_notice']).optional(),
  isPriority: z.coerce.boolean().optional(),
  // implicit: doar active (nu arhivate/dismissed). 'only' — doar cele "nu mă interesează".
  dismissed: z.enum(['only']).optional(),
  search: z.string().trim().optional(),
})

export const UpdateTenderSchema = z.object({
  dismissed: z.boolean(),
})

const watchRuleFields = {
  label: z.string().trim().min(1).max(255),
  cpvPrefix: z.string().trim().min(1).max(20).nullable().optional(),
  keyword: z.string().trim().min(1).max(255).nullable().optional(),
  active: z.boolean().optional(),
  highPriority: z.boolean().optional(),
  exclude: z.boolean().optional(),
}

export const CreateWatchRuleSchema = z
  .object(watchRuleFields)
  .refine((v) => Boolean(v.cpvPrefix) || Boolean(v.keyword), { message: lazyTr('errors.tenders.cpvOrKeyword') })

export const UpdateWatchRuleSchema = z.object({
  label: z.string().trim().min(1).max(255).optional(),
  cpvPrefix: z.string().trim().min(1).max(20).nullable().optional(),
  keyword: z.string().trim().min(1).max(255).nullable().optional(),
  active: z.boolean().optional(),
  highPriority: z.boolean().optional(),
  exclude: z.boolean().optional(),
})
