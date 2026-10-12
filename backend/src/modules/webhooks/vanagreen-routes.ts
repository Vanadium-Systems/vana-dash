import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { config } from '../../shared/config.js'
import { requireIngestToken } from '../../shared/middleware/auth.js'
import { VanagreenAlertIngestSchema } from './vanagreen-schema.js'
import { handleVanagreenAlert } from './vanagreen-service.js'

/**
 * POST /api/webhooks/vanagreen-alert — machine-to-machine, secret dedicat (NU sesiune —
 * apelantul e backend-ul vanagreen, nu un browser). Pattern identic monitoring/routes.ts
 * (X-Ingest-Token comparat cu safeEqual, fail-closed dacă secretul nu e configurat) —
 * mai simplu decât HMAC-ul de la Sentry, e potrivit pt. un apelant intern pe care-l controlăm.
 */
export async function vanagreenAlertRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.post(
    '/api/webhooks/vanagreen-alert',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      onRequest: requireIngestToken('X-Ingest-Token', () => config.vanagreenAlertIngestToken, 'VANAGREEN_ALERT_INGEST_TOKEN'),
      schema: { body: VanagreenAlertIngestSchema },
    },
    async (req) => {
      await handleVanagreenAlert(req.body)
      return { success: true }
    },
  )
}
