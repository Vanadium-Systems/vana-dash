import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { config } from '../../shared/config.js'
import { requireIngestToken } from '../../shared/middleware/auth.js'
import { HealthSignalsQuerySchema, HostMetricsIngestSchema } from './schema.js'
import { getHealthSignalsSummary, ingestHostMetrics, SIGNAL_LABELS } from './service.js'

export async function monitoringRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // POST /api/monitoring/host-metrics — machine-to-machine, secret dedicat (NU sesiune —
  // apelantul e scriptul cron de pe host-ul VPS, nu un browser). Fail-closed: fără token
  // configurat, orice request e respins (401), nu skip silențios.
  server.post(
    '/api/monitoring/host-metrics',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      onRequest: requireIngestToken('X-Ingest-Token', () => config.hostMetricsIngestToken, 'HOST_METRICS_INGEST_TOKEN'),
      schema: { body: HostMetricsIngestSchema },
    },
    async (req) => {
      await ingestHostMetrics(req.body)
      return { success: true }
    },
  )

  // GET /api/monitoring/health-signals — autentificat (single-user, dar consecvent cu restul).
  // Query: range ('1h'|'1d'|'7d', default '7d') — selector pe graficul CPU/RAM/Disk (Stefan, 2026-08-27).
  server.get(
    '/api/monitoring/health-signals',
    { preHandler: [app.authenticate], schema: { querystring: HealthSignalsQuerySchema } },
    async (req) => {
      const { signals, history, hosts } = await getHealthSignalsSummary(req.query.range)
      const toHistoryJson = (points: typeof history) =>
        points.map((h) => ({ captured_at: h.capturedAt.toISOString(), cpu_pct: h.cpuPct, ram_pct: h.ramPct, disk_pct: h.diskPct }))
      const toSignalJson = (s: (typeof signals)[number]) => ({
        key: s.key,
        label: SIGNAL_LABELS[s.key],
        level: s.level,
        value: s.value,
        unit: s.unit,
        detail: s.detail,
        meta: s.meta,
      })
      return {
        success: true,
        data: {
          generated_at: new Date().toISOString(),
          signals: signals.map(toSignalJson),
          history: toHistoryJson(history),
          hosts: hosts.map((h) => ({
            host: h.host,
            last_captured_at: h.lastCapturedAt?.toISOString() ?? null,
            signals: h.signals.map(toSignalJson),
            history: toHistoryJson(h.history),
          })),
        },
      }
    },
  )
}
