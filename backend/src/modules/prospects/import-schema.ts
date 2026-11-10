import { z } from 'zod'
import { FiltersParamSchema } from './filters.js'

export const IMPORT_MAX_ROWS = 5000
export const EXPORT_MAX_ROWS = 10_000

export const ImportCommitSchema = z
  .object({
    token: z.string().uuid(),
    distribution: z.object({
      mode: z.enum(['me', 'user', 'round_robin']),
      userIds: z.array(z.string().uuid()).max(50).optional(),
    }),
  })
  .superRefine((body, ctx) => {
    const { mode, userIds } = body.distribution
    if (mode === 'user' && userIds?.length !== 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['distribution', 'userIds'], message: 'exactly one user' })
    if (mode === 'round_robin' && !userIds?.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['distribution', 'userIds'], message: 'at least one user' })
  })
export type ImportCommitInput = z.infer<typeof ImportCommitSchema>
export type ImportDistribution = ImportCommitInput['distribution']

export const ExportQuerySchema = z.object({
  f: FiltersParamSchema,
  q: z.string().trim().max(200).optional(),
  format: z.enum(['csv', 'xlsx']).default('csv'),
})
export type ExportQuery = z.infer<typeof ExportQuerySchema>
