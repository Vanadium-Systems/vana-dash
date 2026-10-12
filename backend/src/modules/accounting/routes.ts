import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { anafConnector } from '../../connectors/anaf/index.js'
import { buildAuthorizeUrl, exchangeCode, isOauthConfigured } from '../../connectors/anaf/oauth.js'
import { triggerAnafSyncNow } from '../../jobs/sync-anaf.js'
import { getAnafSession, saveAnafTokens } from '../../shared/lib/anaf.js'
import { readDocument } from '../../shared/lib/storage.js'
import * as d301 from './d301.js'
import * as quarterlyPackage from './quarterly-package.js'
import {
  AnafExchangeCodeSchema,
  DeclarationExportQuerySchema,
  DeclarationMonthQuerySchema,
  ManualRecordCreateSchema,
  PaymentUpdateSchema,
  QuarterQuerySchema,
  RecordIdParamsSchema,
  RecordsQuerySchema,
  RecurringExpenseCreateSchema,
  RecurringExpenseIdParamsSchema,
  RecurringExpenseUpdateSchema,
  SpvMessageSaveBodySchema,
  SpvMessageSaveParamsSchema,
  SpvMessagesQuerySchema,
} from './schema.js'
import * as service from './service.js'

export async function accountingRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get(
    '/api/accounting/records',
    { preHandler: [app.authenticate], schema: { querystring: RecordsQuerySchema } },
    async (req) => {
      return { success: true, data: await service.listRecords(req.query) }
    },
  )

  server.post(
    '/api/accounting/records',
    { preHandler: [app.authenticate], schema: { body: ManualRecordCreateSchema } },
    async (req, reply) => {
      const record = await service.createManualRecord(req.body)
      return reply.code(201).send({ success: true, data: record })
    },
  )

  server.get(
    '/api/accounting/records/:id',
    { preHandler: [app.authenticate], schema: { params: RecordIdParamsSchema } },
    async (req, reply) => {
      const record = await service.getRecord(req.params.id)
      if (!record) return reply.code(404).send({ success: false, error: 'Record not found' })
      return { success: true, data: record }
    },
  )

  server.patch(
    '/api/accounting/records/:id/payment',
    { preHandler: [app.authenticate], schema: { params: RecordIdParamsSchema, body: PaymentUpdateSchema } },
    async (req, reply) => {
      const record = await service.updatePayment(req.params.id, req.body)
      if (!record) return reply.code(404).send({ success: false, error: 'Record not found' })
      return { success: true, data: record }
    },
  )

  // Download XML / PDF — stream direct, în afara envelope-ului JSON.
  server.get(
    '/api/accounting/records/:id/xml',
    { preHandler: [app.authenticate], schema: { params: RecordIdParamsSchema } },
    async (req, reply) => {
      const paths = await service.getRecordStoragePaths(req.params.id)
      if (!paths?.xmlStoragePath) return reply.code(404).send({ success: false, error: 'XML indisponibil' })
      const content = await readDocument(paths.xmlStoragePath)
      const fileName = (paths.documentNumber ?? req.params.id).replace(/[/\\"]/g, '_')
      // Content-Disposition: attachment — fără el, browserul randează XML-ul inline într-un
      // viewer în loc să-l descarce (bug raportat: la Primite, spre deosebire de Arhivă unde
      // Stefan doar previzualizează, aici chiar vrea fișierul descărcat pe disc).
      reply.header('Content-Disposition', `attachment; filename="${fileName}.xml"`)
      return reply.type('application/xml').send(content)
    },
  )

  server.get(
    '/api/accounting/records/:id/pdf',
    { preHandler: [app.authenticate], schema: { params: RecordIdParamsSchema } },
    async (req, reply) => {
      const paths = await service.getRecordStoragePaths(req.params.id)
      if (!paths?.pdfStoragePath) return reply.code(404).send({ success: false, error: 'PDF indisponibil' })
      const content = await readDocument(paths.pdfStoragePath)
      const fileName = (paths.documentNumber ?? req.params.id).replace(/[/\\"]/g, '_')
      reply.header('Content-Disposition', `attachment; filename="${fileName}.pdf"`)
      return reply.type('application/pdf').send(content)
    },
  )

  // PDF-ul randat de ANAF (a treia copie a facturii, distinctă de PDF-ul nostru) —
  // disponibil doar după ce jobs/sync-anaf.ts leagă factura de mesajul ANAF.
  server.get(
    '/api/accounting/records/:id/anaf-pdf',
    { preHandler: [app.authenticate], schema: { params: RecordIdParamsSchema } },
    async (req, reply) => {
      const anafPdf = await service.getAnafPdfPath(req.params.id)
      if (!anafPdf) {
        return reply.code(404).send({ success: false, error: 'PDF eFactura indisponibil (nesincronizat încă de la ANAF)' })
      }
      let content
      try {
        content = await readDocument(anafPdf.path)
      } catch {
        return reply.code(404).send({ success: false, error: 'PDF eFactura indisponibil' })
      }
      const fileName = (anafPdf.documentNumber ?? req.params.id).replace(/[/\\"]/g, '_')
      reply.header('Content-Disposition', `attachment; filename="${fileName}_ANAF.pdf"`)
      return reply.type('application/pdf').send(content)
    },
  )

  // Confirmarea de încasare (PDF de curtoazie, vezi shared/lib/payment-confirmation.ts) —
  // regenerată la cerere, nu e persistată (a fost trimisă o singură dată, pe email, la
  // marcarea plății).
  server.get(
    '/api/accounting/records/:id/confirmation-pdf',
    { preHandler: [app.authenticate], schema: { params: RecordIdParamsSchema } },
    async (req, reply) => {
      try {
        const { buffer, documentNumber } = await service.generateConfirmationPdf(req.params.id)
        reply.header('Content-Disposition', `attachment; filename="confirmare-${documentNumber}.pdf"`)
        return reply.type('application/pdf').send(buffer)
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )

  // ── ANAF OAuth + sync ──────────────────────────────────────────────────────

  server.get('/api/accounting/anaf/status', { preHandler: [app.authenticate] }, async () => {
    const status = await service.getAnafStatus()
    return { success: true, data: { ...status, oauthConfigured: isOauthConfigured() } }
  })

  // Pasul 1: Stefan deschide URL-ul în browser (cu certificatul instalat) și consimte.
  server.get('/api/accounting/anaf/authorize-url', { preHandler: [app.authenticate] }, async (_req, reply) => {
    if (!isOauthConfigured()) {
      return reply
        .code(400)
        .send({ success: false, error: 'Setează ANAF_CLIENT_ID și ANAF_CLIENT_SECRET în .env întâi' })
    }
    return { success: true, data: { url: buildAuthorizeUrl() } }
  })

  // Pasul 2: codul din redirect e schimbat pe token-uri (criptate în DB).
  server.post(
    '/api/accounting/anaf/exchange-code',
    { preHandler: [app.authenticate], schema: { body: AnafExchangeCodeSchema } },
    async (req, reply) => {
      try {
        const tokens = await exchangeCode(req.body.code)
        await saveAnafTokens(req.body.cif, tokens)
        return { success: true, data: await service.getAnafStatus() }
      } catch (err) {
        return reply.code(502).send({ success: false, error: String(err) })
      }
    },
  )

  server.post('/api/accounting/anaf/sync', { preHandler: [app.authenticate] }, async (_req, reply) => {
    try {
      const result = await triggerAnafSyncNow()
      return { success: true, data: result }
    } catch (err) {
      return reply.code(400).send({ success: false, error: String(err) })
    }
  })

  // ── Cheltuieli recurente ────────────────────────────────────────────────────

  server.get('/api/accounting/recurring-expenses', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listRecurringExpenses() }
  })

  server.post(
    '/api/accounting/recurring-expenses',
    { preHandler: [app.authenticate], schema: { body: RecurringExpenseCreateSchema } },
    async (req, reply) => {
      const row = await service.createRecurringExpense(req.body)
      return reply.code(201).send({ success: true, data: row })
    },
  )

  server.patch(
    '/api/accounting/recurring-expenses/:id',
    { preHandler: [app.authenticate], schema: { params: RecurringExpenseIdParamsSchema, body: RecurringExpenseUpdateSchema } },
    async (req, reply) => {
      const row = await service.updateRecurringExpense(req.params.id, req.body)
      if (!row) return reply.code(404).send({ success: false, error: 'Cheltuială recurentă negăsită' })
      return { success: true, data: row }
    },
  )

  server.delete(
    '/api/accounting/recurring-expenses/:id',
    { preHandler: [app.authenticate], schema: { params: RecurringExpenseIdParamsSchema } },
    async (req, reply) => {
      const row = await service.deleteRecurringExpense(req.params.id)
      if (!row) return reply.code(404).send({ success: false, error: 'Cheltuială recurentă negăsită' })
      return { success: true }
    },
  )

  // Mesaje SPV — live din ANAF (fereastra cerută) + tot ce a fost salvat explicit (opt-in,
  // vezi spv-messages.ts), unite și marcate cu `saved`. Dacă live-ul pică (ANAF jos), tot
  // arătăm ce-i salvat — nu blocăm pe indisponibilitatea ANAF (regula #7 CLAUDE.md).
  server.get(
    '/api/accounting/anaf/spv-messages',
    { preHandler: [app.authenticate], schema: { querystring: SpvMessagesQuerySchema } },
    async (req, reply) => {
      let session
      try {
        session = await getAnafSession()
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err) })
      }
      const live = await anafConnector.fetchSpvMessages(session, req.query.days).catch((err) => {
        console.error(`[anaf] Fetch live mesaje SPV eșuat: ${String(err)}`)
        return []
      })
      const saved = await service.listSavedSpvMessages()
      const savedIds = new Set(saved.map((m) => m.id))
      const byId = new Map(saved.map((m) => [m.id, { ...m, saved: true }]))
      for (const m of live) byId.set(m.id, { ...m, saved: savedIds.has(m.id) })
      const merged = [...byId.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      return { success: true, data: merged }
    },
  )

  server.post(
    '/api/accounting/anaf/spv-messages/:id/save',
    {
      preHandler: [app.authenticate],
      schema: { params: SpvMessageSaveParamsSchema, body: SpvMessageSaveBodySchema },
    },
    async (req) => {
      return { success: true, data: await service.saveSpvMessage(req.params.id, req.body) }
    },
  )

  // ── D301/D390 — taxare inversă TVA (Sprint D, Track A) ─────────────────────
  // XML-ul rezultat e "gata de semnat" — depunerea prin SPV cere semnătură electronică
  // calificată aplicată manual de Stefan (confirmat la research, niciun API de upload direct).

  server.get(
    '/api/accounting/d301',
    { preHandler: [app.authenticate], schema: { querystring: DeclarationMonthQuerySchema } },
    async (req) => {
      return { success: true, data: await d301.generateD301Preview(req.query.month) }
    },
  )

  server.get(
    '/api/accounting/d390',
    { preHandler: [app.authenticate], schema: { querystring: DeclarationMonthQuerySchema } },
    async (req) => {
      return { success: true, data: await d301.generateD390Preview(req.query.month) }
    },
  )

  server.get(
    '/api/accounting/d301/export',
    { preHandler: [app.authenticate], schema: { querystring: DeclarationExportQuerySchema } },
    async (req, reply) => {
      try {
        if (req.query.format === 'csv') {
          const preview = await d301.generateD301Preview(req.query.month)
          return reply.type('text/csv').send(d301.linesToCsv(preview.lines))
        }
        const xml = await d301.exportD301Xml(req.query.month)
        return reply.type('application/xml').send(xml)
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )

  server.get(
    '/api/accounting/d390/export',
    { preHandler: [app.authenticate], schema: { querystring: DeclarationExportQuerySchema } },
    async (req, reply) => {
      try {
        if (req.query.format === 'csv') {
          const preview = await d301.generateD390Preview(req.query.month)
          return reply.type('text/csv').send(d301.linesToCsv(preview.lines))
        }
        const xml = await d301.exportD390Xml(req.query.month)
        return reply.type('application/xml').send(xml)
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )

  // ── Pachet trimestrial (Sprint D, Track B) ──────────────────────────────────

  server.get(
    '/api/accounting/quarterly-package',
    { preHandler: [app.authenticate], schema: { querystring: QuarterQuerySchema } },
    async (req, reply) => {
      try {
        return { success: true, data: await quarterlyPackage.getQuarterlyPackageSummary(req.query.quarter) }
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )

  server.post(
    '/api/accounting/quarterly-package/generate',
    { preHandler: [app.authenticate], schema: { querystring: QuarterQuerySchema } },
    async (req, reply) => {
      try {
        return { success: true, data: await quarterlyPackage.buildQuarterlyPackage(req.query.quarter) }
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err) })
      }
    },
  )
}
