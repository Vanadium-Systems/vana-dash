import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { config } from '../../shared/config.js'
import { requireIngestToken } from '../../shared/middleware/auth.js'
import { SelfServeBillingClientIngestSchema, SelfServePricingCalculateSchema } from './schema.js'
import { calculateSelfServeQuote, createSelfServeBillingClient, listSelfServeBundles } from './service.js'
import { tr } from '../../shared/lib/i18n.js'

/**
 * POST /api/v1/integrations/vanagreen/pricing/calculate + /billing-clients — machine-to-machine,
 * apelate de recyclers_app (self-serve signup wizard), NU de sesiuni de browser. Fiecare rută
 * are secretul ei dedicat (X-Ingest-Token), NICIODATĂ reutilizat cu VANAGREEN_ALERT_INGEST_TOKEN
 * — pattern identic modules/webhooks/vanagreen-routes.ts (safeEqual, fail-closed dacă secretul
 * lipsește din env). Vezi .github/agents/VANAGREEN.md pt. contractul exact (deja implementat și
 * apelat de recyclers_app, shared/lib/vanadash-pricing-client.ts + vanadash-billing-client.ts).
 */
export async function vanagreenIngestRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  const pricingToken = requireIngestToken('X-Ingest-Token', () => config.vanagreenPricingIngestToken, 'VANAGREEN_PRICING_INGEST_TOKEN')
  const billingToken = requireIngestToken('X-Ingest-Token', () => config.vanagreenBillingIngestToken, 'VANAGREEN_BILLING_INGEST_TOKEN')

  server.post(
    '/api/v1/integrations/vanagreen/pricing/calculate',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      onRequest: pricingToken,
      schema: { body: SelfServePricingCalculateSchema },
    },
    async (req, reply) => {
      const quote = await calculateSelfServeQuote(req.body)
      if (!quote) {
        // recyclers_app tratează orice non-2xx ca "preț indisponibil, te contactăm noi"
        // (non-blocant) — acoperă kill-switch OFF, platforma neconfigurată SAU fără pricing
        // config salvat încă, fără să distingem cazurile față de apelant (nu are nevoie).
        return reply.code(503).send({ success: false, error: tr('errors.vanagreen.priceUnavailable') })
      }
      // FĂRĂ wrapper {success,data} — recyclers_app parsează răspunsul direct ca PricingQuoteResult.
      return quote
    },
  )

  // Catalogul de pachete (2026-08-20) — GET, nu POST: recyclers_app îl citește o dată la
  // încărcarea wizard-ului, ca să știe ce pachete să afișeze (fără să hardcodeze niciun key).
  server.get(
    '/api/v1/integrations/vanagreen/pricing/bundles',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, onRequest: pricingToken },
    async () => {
      return { success: true, data: await listSelfServeBundles() }
    },
  )

  server.post(
    '/api/v1/integrations/vanagreen/billing-clients',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      onRequest: billingToken,
      schema: { body: SelfServeBillingClientIngestSchema },
    },
    async (req) => {
      const row = await createSelfServeBillingClient(req.body)
      return { success: true, data: { id: row.id } }
    },
  )
}
