import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { getPlatform } from '../platforms/service.js'
import { isSelfServePricingEnabled, setSelfServePricingEnabled } from '../vanagreen-ingest/service.js'
import { htmlToPdf, isPdfAvailable } from '../../shared/lib/pdf.js'
import { calculatePrice } from './calc.js'
import { renderPriceSheetHtml } from './price-sheet.js'
import {
  PricingCalculateSchema,
  PricingConfigQuerySchema,
  PricingConfigUpsertSchema,
  SelfServePricingToggleUpdateSchema,
  type PricingConfig,
} from './schema.js'
import * as service from './service.js'

export async function pricingRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get(
    '/api/pricing/config',
    { preHandler: [app.authenticate], schema: { querystring: PricingConfigQuerySchema } },
    async (req) => {
      const row = await service.getConfig(req.query.platformId)
      return { success: true, data: row }
    },
  )

  server.put(
    '/api/pricing/config',
    { preHandler: [app.authenticate], schema: { body: PricingConfigUpsertSchema } },
    async (req, reply) => {
      try {
        const row = await service.upsertConfig(req.body.platformId, req.body.config)
        return { success: true, data: row }
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )

  server.post(
    '/api/pricing/calculate',
    { preHandler: [app.authenticate], schema: { body: PricingCalculateSchema } },
    async (req, reply) => {
      const configRow = await service.getConfig(req.body.platformId)
      if (!configRow) {
        return reply
          .code(404)
          .send({ success: false, error: 'Platforma nu are încă un config de preț salvat (PUT /api/pricing/config întâi)' })
      }
      const result = calculatePrice(configRow.config as PricingConfig, req.body)
      return { success: true, data: result }
    },
  )

  server.get(
    '/api/pricing/price-sheet',
    { preHandler: [app.authenticate], schema: { querystring: PricingConfigQuerySchema } },
    async (req, reply) => {
      const [configRow, platform] = await Promise.all([
        service.getConfig(req.query.platformId),
        getPlatform(req.query.platformId),
      ])
      if (!configRow) {
        return reply
          .code(404)
          .send({ success: false, error: 'Platforma nu are încă un config de preț salvat (PUT /api/pricing/config întâi)' })
      }
      if (!isPdfAvailable()) {
        return reply.code(503).send({ success: false, error: 'Generarea PDF indisponibilă (Chromium neconfigurat) — încearcă din nou mai târziu' })
      }
      const html = renderPriceSheetHtml(configRow.config as PricingConfig, platform?.name ?? 'Platformă')
      const pdf = await htmlToPdf(html)
      reply.header('Content-Disposition', 'inline; filename="fisa-preturi.pdf"')
      return reply.type('application/pdf').send(pdf)
    },
  )

  // Kill-switch preț self-serve (Stefan, 2026-08-04) — vezi modules/vanagreen-ingest/service.ts
  // pt. semantica default-ON și motivul (recyclers_app trebuie să meargă din prima, fără toggle
  // manual). Global, nu per-platformă — o singură cheie dashboard_config.
  server.get('/api/pricing/self-serve-toggle', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: { enabled: await isSelfServePricingEnabled() } }
  })

  server.put(
    '/api/pricing/self-serve-toggle',
    { preHandler: [app.authenticate], schema: { body: SelfServePricingToggleUpdateSchema } },
    async (req) => {
      await setSelfServePricingEnabled(req.body.enabled)
      return { success: true, data: { enabled: req.body.enabled } }
    },
  )
}
