import { z } from 'zod'
import { validatePlatformUrl } from '../../shared/lib/ssrf-guard.js'
import { lazyTr, tr } from '../../shared/lib/i18n.js'

// SSRF protection (security.agent.md) — respinge hostname loopback/private/link-local la
// creare/editare, înainte ca sync jobs să apuce vreodată să facă fetch pe URL-ul salvat.
const platformApiUrl = z
  .string()
  .url()
  .refine(
    (url) => {
      try {
        validatePlatformUrl(url)
        return true
      } catch {
        return false
      }
    },
    { message: lazyTr('errors.platforms.urlNotAllowed') },
  )

// Mapările conectorului generic (sprint de-hardcodare 2026-08-25) — rută relativă pe API-ul
// platformei, cu fragment JSON opțional '#cale.punctata' (vezi connectors/generic/types.ts).
const MetricMappingSchema = z.object({
  metricKey: z.string().trim().min(1),
  unit: z.string().trim().min(1).optional(),
  path: z.string().regex(/^\/\S*$/, lazyTr('errors.platforms.pathRelative')),
  kind: z.enum(['number']).default('number'),
})

const genericHealthPath = z
  .string()
  .regex(/^\/\S*$/, lazyTr('errors.platforms.healthPathRelative'))
  .nullable()
  .optional()

// ATENȚIE: niciun schema de response nu conține apiKeyEnc sau apiKey.
export const PlatformSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z.string(),
  apiUrl: z.string(),
  syncCron: z.string(),
  healthStatus: z.enum(['unknown', 'healthy', 'degraded', 'down']),
  lastSyncAt: z.coerce.date().nullable(),
  metricMappings: z.array(MetricMappingSchema).nullable().optional(),
  healthPath: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
})

const PlatformBaseSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  apiUrl: platformApiUrl,
  // Write-only: intră aici, se criptează, nu mai iese niciodată.
  apiKey: z.string().min(1),
  syncCron: z.string().min(1).default('*/30 * * * *'),
  metricMappings: z.array(MetricMappingSchema).optional(),
  healthPath: genericHealthPath,
})

// Mapările aparțin exclusiv conectorului generic — respinse explicit la create pe alt tip.
export const PlatformCreateSchema = PlatformBaseSchema.superRefine((input, ctx) => {
  if (input.type !== 'generic' && (input.metricMappings || input.healthPath)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: tr('errors.platforms.genericOnly'),
      path: ['metricMappings'],
    })
  }
})

export const PlatformUpdateSchema = PlatformBaseSchema.partial().superRefine((input, ctx) => {
  // La update fără `type` în payload, gardul e aplicat în service (contra tipului curent din DB).
  if (input.type !== undefined && input.type !== 'generic' && (input.metricMappings || input.healthPath)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: tr('errors.platforms.genericOnly'),
      path: ['metricMappings'],
    })
  }
})

export const PlatformIdParamsSchema = z.object({ id: z.string().uuid() })

export const SyncLogEntrySchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['RUNNING', 'SUCCESS', 'FAILED']),
  recordsSync: z.number(),
  errorMessage: z.string().nullable(),
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullable(),
})
