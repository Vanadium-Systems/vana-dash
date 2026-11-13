import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { createVanagreenTenantForClient, pushBillingCycleIfMapped, pushLegalDetailsIfMapped } from '../reconciliation/vanagreen-extension.js'
import { runVanagreenTenantSyncJob } from '../../jobs/vanagreen-tenant-sync.js'
import { lookupCompany } from '../../countries/ro/company-lookup.js'
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
  ProformaListQuerySchema,
  SequenceKeyQuerySchema,
  SequenceUpdateSchema,
  StornoCreateSchema,
  TemplateResolveQuerySchema,
} from './schema.js'
import { ClientPricingSchema } from './pricing-apply.js'
import { InvoicingError } from './errors.js'
import * as proforma from './proforma.js'
import * as service from './service.js'
import { createStornoDraft } from './storno.js'
import { tr } from '../../shared/lib/i18n.js'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { peekNextInvoiceNumber } from '../../shared/lib/sequences.js'

// Sprint C, Track D — generează un slug kebab-case din numele clientului când Stefan nu
// dă unul explicit la creare. Diacritice simple normalizate (ă/â/î/ș/ț → a/a/i/s/t).
function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// Domain errors keep their status and code; anything else answers 400 as the older routes do.
function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof InvoicingError) {
    return reply.code(err.statusCode).send({ success: false, error: { code: err.code, message: err.message } })
  }
  if (err instanceof service.InvoiceConflictError) {
    return reply.code(409).send({ success: false, error: { code: err.code, message: err.message } })
  }
  // A failed query carries its SQL and parameters in the message: let the global handler mask it.
  if (err instanceof DrizzleQueryError || (err instanceof Error && err.name === 'PostgresError')) throw err
  return reply.code(400).send({ success: false, error: String(err) })
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
        // Through the shared gate (one in flight, 2s apart, cached, paused after a 403/429).
        return { success: true, data: await lookupCompany(req.params.cif) }
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode === 503 ? 503 : 400
        return reply.code(status).send({ success: false, error: String(err) })
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

  server.post(
    '/api/invoicing/clients/:id/pricing/preview',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema, body: ClientPricingSchema } },
    async (req, reply) => {
      const result = await service.previewClientPricing(req.params.id, req.body)
      if (!result) return reply.code(404).send({ success: false, error: 'Client not found' })
      return { success: true, data: result }
    },
  )

  server.patch(
    '/api/invoicing/clients/:id/pricing',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema, body: ClientPricingSchema } },
    async (req, reply) => {
      const result = await service.applyClientPricing(req.params.id, req.body)
      if (!result) return reply.code(404).send({ success: false, error: 'Client not found' })
      return { success: true, data: result }
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
        return fail(reply, err)
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
        return fail(reply, err)
      }
    },
  )

  // The editor's pickers live under the invoices prefix (facturi.view): the client routes need
  // facturi.clienti, which a colleague who only issues invoices does not have.
  server.get('/api/invoicing/invoices/clients', { preHandler: [app.authenticate] }, async () => ({
    success: true,
    data: await service.listClientsForInvoicing(),
  }))

  server.get(
    '/api/invoicing/invoices/clients/:clientId/templates',
    { preHandler: [app.authenticate], schema: { params: ClientIdParamsSchema } },
    async (req) => ({ success: true, data: await service.listClientTemplates(req.params.clientId) }),
  )

  server.get(
    '/api/invoicing/invoices/clients/:clientId/templates/:id/resolve',
    { preHandler: [app.authenticate], schema: { params: ClientTemplateResolveParamsSchema, querystring: TemplateResolveQuerySchema } },
    async (req, reply) => {
      try {
        return { success: true, data: await service.resolveClientTemplateLines(req.params.clientId, req.params.id, req.query.currency) }
      } catch (err) {
        return fail(reply, err)
      }
    },
  )

  // The editor's confirmation step names the number the issue will get. Under facturi.view, not
  // the series settings, so a colleague who issues invoices can read it.
  server.get(
    '/api/invoicing/invoices/next-number',
    { preHandler: [app.authenticate], schema: { querystring: SequenceKeyQuerySchema } },
    async (req) => ({ success: true, data: await peekNextInvoiceNumber(req.query.key) }),
  )

  // The editor calls this on every pause in typing. The limit is per person and runs after
  // authentication (preHandler) so a colleague on the same IP does not share the bucket.
  server.post(
    '/api/invoicing/invoices/preview',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 60, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: (req) => req.me.id } },
      schema: { body: InvoiceCreateSchema },
    },
    async (req, reply) => {
      try {
        return { success: true, data: { html: await service.previewDraftInvoice(req.body) } }
      } catch (err) {
        return fail(reply, err)
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
        return fail(reply, err)
      }
    },
  )

  server.post(
    '/api/invoicing/invoices/:id/duplicate',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      try {
        const draft = await service.duplicateInvoice(req.params.id)
        if (!draft) return reply.code(404).send({ success: false, error: 'Invoice not found' })
        return reply.code(201).send({ success: true, data: draft })
      } catch (err) {
        return fail(reply, err)
      }
    },
  )

  // A storno is a draft invoice with negative quantities; issuing it goes through /issue like any invoice.
  server.post(
    '/api/invoicing/invoices/:id/storno',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema, body: StornoCreateSchema } },
    async (req, reply) => {
      try {
        const draft = await createStornoDraft(req.params.id, req.body)
        if (!draft) return reply.code(404).send({ success: false, error: 'Invoice not found' })
        return reply.code(201).send({ success: true, data: draft })
      } catch (err) {
        return fail(reply, err)
      }
    },
  )

  // The stored document as HTML: the only preview a storno draft or a proforma can have by id.
  server.get(
    '/api/invoicing/invoices/:id/preview',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      try {
        const html = await service.previewStoredDocument(req.params.id)
        if (html === null) return reply.code(404).send({ success: false, error: 'Invoice not found' })
        return { success: true, data: { html } }
      } catch (err) {
        return fail(reply, err)
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
        return fail(reply, err)
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
        return fail(reply, err)
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
        return fail(reply, err)
      }
    },
  )

  // ── Secvența de numerotare ─────────────────────────────────────────────────

  // `?key=proforma` is the proforma series; without it, the invoice series as before.
  server.get(
    '/api/invoicing/sequence',
    { preHandler: [app.authenticate], schema: { querystring: SequenceKeyQuerySchema } },
    async (req) => {
      return { success: true, data: await service.getSequence(req.query.key) }
    },
  )

  server.patch(
    '/api/invoicing/sequence',
    { preHandler: [app.authenticate], schema: { querystring: SequenceKeyQuerySchema, body: SequenceUpdateSchema } },
    async (req) => {
      return { success: true, data: await service.updateSequence(req.body, req.query.key) }
    },
  )

  // ── Proforme ───────────────────────────────────────────────────────────────

  server.get(
    '/api/invoicing/proformas',
    { preHandler: [app.authenticate], schema: { querystring: ProformaListQuerySchema } },
    async (req) => {
      return { success: true, data: await proforma.listProformas(req.query) }
    },
  )

  server.post(
    '/api/invoicing/proformas',
    { preHandler: [app.authenticate], schema: { body: InvoiceCreateSchema } },
    async (req, reply) => {
      try {
        return reply.code(201).send({ success: true, data: await service.createDraftInvoice(req.body, { kind: 'proforma' }) })
      } catch (err) {
        return fail(reply, err)
      }
    },
  )

  server.post(
    '/api/invoicing/proformas/preview',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 60, timeWindow: '1 minute', hook: 'preHandler', keyGenerator: (req) => req.me.id } },
      schema: { body: InvoiceCreateSchema },
    },
    async (req, reply) => {
      try {
        return { success: true, data: { html: await service.previewDraftInvoice(req.body, 'proforma') } }
      } catch (err) {
        return fail(reply, err)
      }
    },
  )

  server.patch(
    '/api/invoicing/proformas/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema, body: InvoiceUpdateSchema } },
    async (req, reply) => {
      try {
        const row = await service.updateDraftInvoice(req.params.id, req.body, 'proforma')
        if (!row) return reply.code(404).send({ success: false, error: { code: 'PROFORMA_NOT_FOUND', message: tr('errors.invoicing.proformaNotFound') } })
        return { success: true, data: row }
      } catch (err) {
        return fail(reply, err)
      }
    },
  )

  server.delete(
    '/api/invoicing/proformas/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      try {
        const deleted = await service.deleteDraftInvoice(req.params.id, 'proforma')
        if (!deleted) return reply.code(404).send({ success: false, error: { code: 'PROFORMA_NOT_FOUND', message: tr('errors.invoicing.proformaNotFound') } })
        return { success: true }
      } catch (err) {
        return fail(reply, err)
      }
    },
  )

  for (const [action, run] of [
    ['issue', proforma.issueProforma],
    ['convert', proforma.convertProforma],
    ['cancel', proforma.cancelProforma],
  ] as const) {
    server.post(
      `/api/invoicing/proformas/:id/${action}`,
      { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
      async (req, reply) => {
        try {
          const row = await run(req.params.id)
          if (!row) return reply.code(404).send({ success: false, error: { code: 'PROFORMA_NOT_FOUND', message: tr('errors.invoicing.proformaNotFound') } })
          return reply.code(action === 'convert' ? 201 : 200).send({ success: true, data: row })
        } catch (err) {
          return fail(reply, err)
        }
      },
    )
  }

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
        return fail(reply, err)
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
        return fail(reply, err)
      }
    },
  )
}
