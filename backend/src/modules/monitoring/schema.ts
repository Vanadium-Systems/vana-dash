import { z } from 'zod'

export const SignalLevelSchema = z.enum(['green', 'yellow', 'red'])
export const SignalKeySchema = z.enum(['cpu', 'ram', 'disk', 'containers', 'jobs_failed', 'backup'])

export const HostMetricsIngestSchema = z
  .object({
    host: z.enum(['dash', 'server-1']).default('dash'),
    cpu_pct: z.number().min(0).max(100),
    ram_pct: z.number().min(0).max(100),
    disk_pct: z.number().min(0).max(100),
    // nume container -> status ('healthy' | 'starting' | 'stopped' | ...).
    containers: z.record(z.string().min(1).max(200), z.string().min(1).max(100)),
  })
  .strict()

export type HostMetricsIngestBody = z.infer<typeof HostMetricsIngestSchema>

export const HealthSignalsQuerySchema = z.object({
  range: z.enum(['1h', '1d', '7d']).default('7d'),
})
