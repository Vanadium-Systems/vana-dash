import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { createVanagreenTenantForClient, pushBillingCycleIfMapped, pushLegalDetailsIfMapped } from '../reconciliation/vanagreen-extension.js'
import { runVanagreenTenantSyncJob } from '../../jobs/vanagreen-tenant-sync.js'
import { lookupCompanyByCui } from '../../shared/lib/anaf-lookup.js'
import {
  CifParamsSchema,
  ClientCreateWithVanagreenSchema,
  ClientIdParamsSchema,
  ClientTemplateResolveParamsSchema,
  ClientUpdateSchema,
  ExchangeRateLookupQuerySchema,
  IdParamsSchema,
  InvoiceCreateSchema,
  InvoiceTemplateCreateSchema,
  InvoiceTemplateUpdateSchema,
  InvoiceUpdateSchema,
  PlatformIdParamsSchema,
  PlatformTemplateIdParamsSchema,
  SequenceUpdateSchema,
  TemplateResolveQuerySchema,
} from './schema.js'
import * as service from './service.js'
import { tr } from '../../shared/lib/i18n.js'

// Sprint C, Track D — generează un slug kebab-case din numele clientului când Stefan nu
// dă unul explicit la creare. Diacritice simple normalizate (ă/â/î/ș/ț → a/a/i/s/t).
function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function invoicingRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // ── Billing clients ────────────────────────────────────────────────────────

  server.get('/api/invoicing/clients', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listClients() }
  })

  // 2026-08-03 — tenanți demo vanagreen, sincronizați de jobs/vanagreen-tenant-sync.ts, afișați
  // separat de clienții reali (ClientsTab.tsx).
  server.get('/api/invoicing/clients/demo', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listDemoClients() }
  })

  // 2026-08-11 — tenanți reziliați în vanagreen, în fereastra de 30 zile înainte de purjare
  // locală automată (jobs/vanagreen-tenant-sync.ts), afișați separat (ClientsTab.tsx).
  server.get('/api/invoicing/clients/pending-deletion', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listPendingDeletionClients() }
  })

  // Rulare manuală a jobs/vanagreen-tenant-sync.ts (cronul zilnic 06:30) — buton „Sincronizează
  // acum" (ClientsTab.tsx, 2026-09-21) pt. clienți noi/modificați în vanagreen fără să aștepți
  // rularea automată.
  server.post('/api/invoicing/clients/sync-vanagreen', { preHandler: [app.authenticate] }, async () => {
    await runVanagreenTenantSyncJob()
    return { success: true, data: await service.listClients() }
  })

  // Fills the client form from ANAF when the tax id is typed. It exists because ANAF rejects
  // an invoice whose buyer data is wrong or incomplete (the county, most often).
  server.get(
    '/api/invoicing/anaf-lookup/:cif',
    { preHandler: [app.authenticate], schema: { params: CifParamsSchema } },
    async (req, reply) => {
      try {
        return { success: true, data: await lookupCompanyByCui(req.params.cif) }
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )

  server.post(
    '/api/invoicing/clients',
    { preHandler: [app.authenticate], schema: { body: ClientCreateWithVanagreenSchema } },
    async (req, reply) => {
      const { createInVanagreen, slug: inputSlug, ...rest } = req.body
      const slug = inputSlug ?? slugify(rest.name)

      let vanagreenTenantId = rest.vanagreenTenantId ?? null
      if (createInVanagreen) {
        const result = await createVanagreenTenantForClient(slug, rest.name)
        if (!result.ok) {
          const status = result.code === 'SLUG_TAKEN' ? 409 : 502
          return reply.code(status).send({
            success: false,
            error: { code: result.code ?? 'VANAGREEN_CREATE_FAILED', message: result.message ?? tr('errors.invoicing.tenantCreateFailed') },
          })
        }
        vanagreenTenantId = result.id ?? null
      }

      const client = await service.createClient({ ...rest, slug, vanagreenTenantId })
      return reply.code(201).send({ success: true, data: client })
    },
  )

  server.patch(
    '/api/invoicing/clients/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema, body: ClientUpdateSchema } },
    async (req, reply) => {
      const client = await service.updateClient(req.params.id, req.body)
      if (!client) return reply.code(404).send({ success: false, error: 'Client not found' })
      // Fire-and-forget izolat (regula #7 CLAUDE.md) — nu blochează răspunsul, nu aruncă.
      void pushLegalDetailsIfMapped(client)
      void pushBillingCycleIfMapped(client)
      return { success: true, data: client }
    },
  )

  server.delete(
    '/api/invoicing/clients/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      const deleted = await service.softDeleteClient(req.params.id)
      if (!deleted) return reply.code(404).send({ success: false, error: 'Client not found' })
      return { success: true }
    },
  )

  // Curs BNR pt. un preț introdus într-o altă valută decât factura (ex: 200 EUR pe o
  // factură RON) — InvoiceFormDialog îl folosește ca să calculeze unitPrice-ul convertit.
  server.get(
    '/api/invoicing/exchange-rate',
    { preHandler: [app.authenticate], schema: { querystring: ExchangeRateLookupQuerySchema } },
    async (req, reply) => {
      try {
        const rate = await service.getExchangeRateForInvoicing(req.query.currency, req.query.date)
        return { success: true, data: rate }
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )

  // ── Facturi ────────────────────────────────────────────────────────────────

  server.get('/api/invoicing/invoices', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listInvoices() }
  })

  server.post(
    '/api/invoicing/invoices',
    { preHandler: [app.authenticate], schema: { body: InvoiceCreateSchema } },
    async (req, reply) => {
      try {
        return reply.code(201).send({ success: true, data: await service.createDraftInvoice(req.body) })
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )

  server.patch(
    '/api/invoicing/invoices/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema, body: InvoiceUpdateSchema } },
    async (req, reply) => {
      try {
        const invoice = await service.updateDraftInvoice(req.params.id, req.body)
        if (!invoice) return reply.code(404).send({ success: false, error: 'Invoice not found' })
        return { success: true, data: invoice }
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )

  server.delete(
    '/api/invoicing/invoices/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      try {
        const deleted = await service.deleteDraftInvoice(req.params.id)
        if (!deleted) return reply.code(404).send({ success: false, error: 'Invoice not found' })
        return { success: true }
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )

  server.post(
    '/api/invoicing/invoices/:id/issue',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      try {
        const invoice = await service.issueInvoice(req.params.id)
        if (!invoice) return reply.code(404).send({ success: false, error: 'Invoice not found' })
        return { success: true, data: invoice }
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )

  server.post(
    '/api/invoicing/invoices/:id/send-anaf',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      try {
        const invoice = await service.sendInvoiceToAnaf(req.params.id)
        if (!invoice) return reply.code(404).send({ success: false, error: 'Invoice not found' })
        return { success: true, data: invoice }
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )

  // ── Secvența de numerotare ─────────────────────────────────────────────────

  server.get('/api/invoicing/sequence', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.getSequence() }
  })

  server.patch(
    '/api/invoicing/sequence',
    { preHandler: [app.authenticate], schema: { body: SequenceUpdateSchema } },
    async (req) => {
      return { success: true, data: await service.updateSequence(req.body) }
    },
  )

  // ── Template-uri de facturi per PLATFORMĂ (Sprint D, Track 3; re-scope 2026-07-18) ──
  // 2-3 template-uri per aplicație integrată, reutilizate de toți clienții ei.

  server.get(
    '/api/invoicing/platforms/:platformId/templates',
    { preHandler: [app.authenticate], schema: { params: PlatformIdParamsSchema } },
    async (req) => {
      return { success: true, data: await service.listPlatformTemplates(req.params.platformId) }
    },
  )

  server.post(
    '/api/invoicing/platforms/:platformId/templates',
    { preHandler: [app.authenticate], schema: { params: PlatformIdParamsSchema, body: InvoiceTemplateCreateSchema } },
    async (req, reply) => {
      try {
        const template = await service.createPlatformTemplate(req.params.platformId, req.body)
        return reply.code(201).send({ success: true, data: template })
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )

  server.patch(
    '/api/invoicing/platforms/:platformId/templates/:id',
    { preHandler: [app.authenticate], schema: { params: PlatformTemplateIdParamsSchema, body: InvoiceTemplateUpdateSchema } },
    async (req, reply) => {
      const template = await service.updatePlatformTemplate(req.params.platformId, req.params.id, req.body)
      if (!template) return reply.code(404).send({ success: false, error: 'Template not found' })
      return { success: true, data: template }
    },
  )

  server.delete(
    '/api/invoicing/platforms/:platformId/templates/:id',
    { preHandler: [app.authenticate], schema: { params: PlatformTemplateIdParamsSchema } },
    async (req, reply) => {
      const deleted = await service.deletePlatformTemplate(req.params.platformId, req.params.id)
      if (!deleted) return reply.code(404).send({ success: false, error: 'Template not found' })
      return { success: true }
    },
  )

  // Convenience: template-urile disponibile la facturarea UNUI client (derivate din
  // platforma lui) — folosit de picker-ul din InvoiceFormDialog.
  server.get(
    '/api/invoicing/clients/:clientId/templates',
    { preHandler: [app.authenticate], schema: { params: ClientIdParamsSchema } },
    async (req) => {
      return { success: true, data: await service.listClientTemplates(req.params.clientId) }
    },
  )

  // Preview: rezolvă liniile cu preț fix ca atare, cele "din abonamentul clientului" cu
  // prețul curent (convertit la `currency` prin curs BNR dacă diferă) — folosit de
  // InvoiceFormDialog la alegerea unui template, ÎNAINTE de a crea draft-ul.
  server.get(
    '/api/invoicing/clients/:clientId/templates/:id/resolve',
    { preHandler: [app.authenticate], schema: { params: ClientTemplateResolveParamsSchema, querystring: TemplateResolveQuerySchema } },
    async (req, reply) => {
      try {
        const resolved = await service.resolveClientTemplateLines(req.params.clientId, req.params.id, req.query.currency)
        return { success: true, data: resolved }
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )
}
