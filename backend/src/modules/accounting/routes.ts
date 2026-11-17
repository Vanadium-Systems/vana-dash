import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { anafConnector } from '../../connectors/anaf/index.js'
import { buildAuthorizeUrl, exchangeCode, isOauthConfigured, refreshTokens } from '../../connectors/anaf/oauth.js'
import { triggerAnafSyncNow } from '../../jobs/sync-anaf.js'
import { getAnafCredentialsRow, getAnafSession, saveAnafTokens } from '../../shared/lib/anaf.js'
import { decryptField } from '../../shared/lib/crypto.js'
import { readDocument } from '../../shared/lib/storage.js'
import { PaymentError } from '../../shared/lib/payments.js'
import * as d301 from './d301.js'
import { listDeadlines } from './deadlines.js'
import * as monthClose from './month-close.js'
import * as quarterlyPackage from './quarterly-package.js'
import { getRecordDetail } from './record-detail.js'
import { listRecordsPage } from './records-list.js'
import {
  AnafExchangeCodeSchema,
  ConfirmRecordReviewSchema,
  DeclarationExportQuerySchema,
  DeclarationFilingBodySchema,
  DeclarationLineParamsSchema,
  DeclarationLineUpdateSchema,
  DeclarationMonthQuerySchema,
  FulfillExpectedBodySchema,
  ImportFromEmailBodySchema,
  ManualRecordCreateSchema,
  MonthCloseArchiveMissingBodySchema,
  MonthCloseArchiveMissingQuerySchema,
  MonthCloseQuerySchema,
  MonthCloseStatusBodySchema,
  PaymentUpdateSchema,
  PrefillFromEmailQuerySchema,
  QuarterQuerySchema,
  RecordIdParamsSchema,
  RecordsQuerySchema,
  RecurringExpenseCreateSchema,
  RecurringExpenseIdParamsSchema,
  RecurringExpenseUpdateSchema,
  SpvMessageSaveBodySchema,
  SpvMessageSaveParamsSchema,
  SpvMessagesQuerySchema,
  SupplierRuleBackfillSchema,
  SupplierRuleCreateSchema,
  SupplierRuleIdParamsSchema,
  SupplierRuleUpdateSchema,
  UploadRecordPdfSchema,
} from './schema.js'
import * as service from './service.js'
import * as supplierEmail from './supplier-email.js'
import { tr } from '../../shared/lib/i18n.js'
import { CompanyProfileIncompleteError } from '../../countries/types.js'
import { fail, HttpError } from '../../shared/lib/http-error.js'

// The exports run through ANAF-format builders, the PDF filler and storage; a business rule
// (missing VAT code, incomplete company sheet) keeps its own text, the rest stays in the log.
function declarationExportFailure(req: FastifyRequest, reply: FastifyReply, err: unknown) {
  if (err instanceof HttpError) throw err
  if (err instanceof CompanyProfileIncompleteError) {
    return fail(reply, 400, 'COMPANY_PROFILE_INCOMPLETE', { message: err.message, details: { fields: err.fields } })
  }
  req.log.warn({ err }, 'declaration export failed')
  return fail(reply, 400, 'DECLARATION_EXPORT_FAILED')
}

function quarterlyPackageFailure(req: FastifyRequest, reply: FastifyReply, err: unknown) {
  if (err instanceof HttpError) throw err
  req.log.warn({ err }, 'quarterly package failed')
  return fail(reply, 400, 'QUARTERLY_PACKAGE_FAILED')
}

export async function accountingRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get(
    '/api/accounting/records',
    { preHandler: [app.authenticate], schema: { querystring: RecordsQuerySchema } },
    async (req) => ({ success: true, data: await listRecordsPage(req.query) }),
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
      if (!record) return fail(reply, 404, 'RECORD_NOT_FOUND')
      return { success: true, data: record }
    },
  )

  // Everything the document page shows, in one round trip.
  server.get(
    '/api/accounting/records/:id/detail',
    { preHandler: [app.authenticate], schema: { params: RecordIdParamsSchema } },
    async (req, reply) => {
      const detail = await getRecordDetail(req.params.id)
      if (!detail) {
        return fail(reply, 404, 'RECORD_NOT_FOUND')
      }
      return { success: true, data: detail }
    },
  )

  server.patch(
    '/api/accounting/records/:id/payment',
    { preHandler: [app.authenticate], schema: { params: RecordIdParamsSchema, body: PaymentUpdateSchema } },
    async (req, reply) => {
      try {
        const record = await service.updatePayment(req.params.id, req.body)
        if (!record) return fail(reply, 404, 'RECORD_NOT_FOUND')
        return { success: true, data: record }
      } catch (err) {
        if (!(err instanceof PaymentError)) throw err
        return fail(reply, err.statusCode, err.code, { message: err.message })
      }
    },
  )

  // Download XML / PDF — stream direct, în afara envelope-ului JSON.
  server.get(
    '/api/accounting/records/:id/xml',
    { preHandler: [app.authenticate], schema: { params: RecordIdParamsSchema } },
    async (req, reply) => {
      const paths = await service.getRecordStoragePaths(req.params.id)
      if (!paths?.xmlStoragePath) return fail(reply, 404, 'RECORD_XML_UNAVAILABLE', { message: tr('errors.accounting.xmlUnavailable') })
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
      if (!paths?.pdfStoragePath) return fail(reply, 404, 'RECORD_PDF_UNAVAILABLE', { message: tr('errors.accounting.pdfUnavailable') })
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
        return fail(reply, 404, 'EFACTURA_PDF_NOT_SYNCED', { message: tr('errors.accounting.efacturaPdfNotSynced') })
      }
      let content
      try {
        content = await readDocument(anafPdf.path)
      } catch {
        return fail(reply, 404, 'EFACTURA_PDF_UNAVAILABLE', { message: tr('errors.accounting.efacturaPdfUnavailable') })
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
        if (err instanceof HttpError) throw err
        req.log.warn({ err }, 'confirmation PDF failed')
        return fail(reply, 400, 'CONFIRMATION_PDF_FAILED')
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
      return fail(reply, 400, 'ANAF_OAUTH_NOT_CONFIGURED', { message: tr('errors.accounting.setAnafEnvFirst') })
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
        req.log.warn({ err }, 'ANAF code exchange failed')
        return fail(reply, 502, 'ANAF_CODE_EXCHANGE_FAILED')
      }
    },
  )

  // On-demand refresh. A failure does not mark needs_reauth: a passing ANAF outage should not
  // force a new consent. The nightly job does that if the failure persists.
  server.post('/api/accounting/anaf/refresh', { preHandler: [app.authenticate] }, async (req, reply) => {
    const row = await getAnafCredentialsRow()
    if (!row || row.status !== 'active' || !row.refreshTokenEnc) {
      return fail(reply, 400, 'ANAF_NOT_CONFIGURED')
    }
    try {
      await saveAnafTokens(row.cif, await refreshTokens(await decryptField(row.refreshTokenEnc)))
      return { success: true, data: await service.getAnafStatus() }
    } catch (err) {
      req.log.warn({ err }, 'ANAF token refresh failed')
      return fail(reply, 502, 'ANAF_TOKEN_REFRESH_FAILED')
    }
  })

  server.post('/api/accounting/anaf/sync', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const result = await triggerAnafSyncNow()
      return { success: true, data: result }
    } catch (err) {
      if (err instanceof HttpError) throw err
      req.log.warn({ err }, 'ANAF sync failed')
      return fail(reply, 400, 'ANAF_UNAVAILABLE')
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
      if (!row) return fail(reply, 404, 'RECURRING_EXPENSE_NOT_FOUND', { message: tr('errors.accounting.recurringNotFound') })
      return { success: true, data: row }
    },
  )

  server.delete(
    '/api/accounting/recurring-expenses/:id',
    { preHandler: [app.authenticate], schema: { params: RecurringExpenseIdParamsSchema } },
    async (req, reply) => {
      const row = await service.deleteRecurringExpense(req.params.id)
      if (!row) return fail(reply, 404, 'RECURRING_EXPENSE_NOT_FOUND', { message: tr('errors.accounting.recurringNotFound') })
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
        if (err instanceof HttpError) throw err
        req.log.warn({ err }, 'ANAF session failed')
        return fail(reply, 400, 'ANAF_UNAVAILABLE')
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

  server.get('/api/accounting/deadlines', { preHandler: [app.authenticate] }, async (req) => ({
    success: true,
    data: { items: await listDeadlines(req.me.features) },
  }))

  // ── D301/D390 — taxare inversă TVA (Sprint D, Track A) ─────────────────────
  // SPV takes the ANAF PDF form, signed with a qualified certificate in Adobe Reader; there is no
  // upload API. format=pdf is that form prefilled, xml and csv stay for the accountant.

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

  for (const code of ['D301', 'D390'] as const) {
    server.put(
      `/api/accounting/${code.toLowerCase()}/filing`,
      { preHandler: [app.authenticate], schema: { body: DeclarationFilingBodySchema } },
      async (req) => {
        return { success: true, data: await d301.saveFiling(code, req.body) }
      },
    )
  }

  server.patch(
    '/api/accounting/d301/lines/:id',
    { preHandler: [app.authenticate], schema: { params: DeclarationLineParamsSchema, body: DeclarationLineUpdateSchema } },
    async (req, reply) => {
      try {
        const row = await d301.updateDeclarationLine(req.params.id, req.body)
        if (!row) return fail(reply, 404, 'RECORD_NOT_FOUND')
        return { success: true, data: row }
      } catch (err) {
        if (err instanceof HttpError) throw err
        req.log.warn({ err }, 'declaration line update failed')
        return fail(reply, 400, 'DECLARATION_LINE_UPDATE_FAILED')
      }
    },
  )

  server.get(
    '/api/accounting/d301/export',
    { preHandler: [app.authenticate], schema: { querystring: DeclarationExportQuerySchema } },
    async (req, reply) => {
      try {
        if (req.query.format === 'csv') {
          const preview = await d301.generateD301Preview(req.query.month)
          return reply.type('text/csv').send(d301.linesToCsv(preview.lines.filter((l) => l.confirmed)))
        }
        if (req.query.format === 'pdf') {
          const pdf = await d301.exportD301Pdf(req.query.month)
          return reply
            .type('application/pdf')
            .header('content-disposition', `attachment; filename="${await d301.declarationFileName('D301', req.query.month, 'pdf')}"`)
            .send(pdf)
        }
        const xml = await d301.exportD301Xml(req.query.month)
        return reply
          .type('application/xml')
          .header('content-disposition', `attachment; filename="${await d301.declarationFileName('D301', req.query.month, 'xml')}"`)
          .send(xml)
      } catch (err) {
        return declarationExportFailure(req, reply, err)
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
          return reply.type('text/csv').send(d301.linesToCsv(preview.lines.filter((l) => l.confirmed)))
        }
        if (req.query.format === 'pdf') {
          const pdf = await d301.exportD390Pdf(req.query.month)
          return reply
            .type('application/pdf')
            .header('content-disposition', `attachment; filename="${await d301.declarationFileName('D390', req.query.month, 'pdf')}"`)
            .send(pdf)
        }
        const xml = await d301.exportD390Xml(req.query.month)
        return reply
          .type('application/xml')
          .header('content-disposition', `attachment; filename="${await d301.declarationFileName('D390', req.query.month, 'xml')}"`)
          .send(xml)
      } catch (err) {
        return declarationExportFailure(req, reply, err)
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
        return quarterlyPackageFailure(req, reply, err)
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
        return quarterlyPackageFailure(req, reply, err)
      }
    },
  )

  // ── Record review confirmation, manual PDF upload & archiving ──────────────

  server.post(
    '/api/accounting/records/:id/confirm-review',
    {
      preHandler: [app.authenticate],
      schema: { params: RecordIdParamsSchema, body: ConfirmRecordReviewSchema },
    },
    async (req, reply) => {
      try {
        const record = await service.confirmRecordReview(req.params.id, req.body, req.me.id)
        if (!record) return fail(reply, 404, 'RECORD_NOT_FOUND')
        return { success: true, data: record }
      } catch (err) {
        if (err instanceof service.DuplicateDocumentNumberError) {
          return fail(reply, 409, 'DUPLICATE_DOCUMENT_NUMBER', { message: err.message })
        }
        throw err
      }
    },
  )

  server.post(
    '/api/accounting/records/:id/upload-pdf',
    {
      preHandler: [app.authenticate],
      schema: { params: RecordIdParamsSchema, body: UploadRecordPdfSchema },
    },
    async (req, reply) => {
      try {
        const record = await service.uploadRecordPdf(req.params.id, req.body, req.me.id)
        if (!record) return fail(reply, 404, 'RECORD_NOT_FOUND')
        return { success: true, data: record }
      } catch (err) {
        if (err instanceof service.InvalidPdfUploadError) {
          return fail(reply, 400, 'INVALID_PDF_UPLOAD')
        }
        throw err
      }
    },
  )

  server.post(
    '/api/accounting/records/:id/archive',
    {
      preHandler: [app.authenticate],
      schema: { params: RecordIdParamsSchema },
    },
    async (req, reply) => {
      const result = await service.archiveRecordNow(req.params.id)
      if (!result) return fail(reply, 404, 'RECORD_NOT_FOUND')
      return { success: true, data: result }
    },
  )

  // ── Monthly close checklist (Facturi -> Luna) ──────────────────────────────

  server.get(
    '/api/accounting/month-close',
    { preHandler: [app.authenticate], schema: { querystring: MonthCloseQuerySchema } },
    async (req) => ({ success: true, data: await monthClose.getMonthClose(req.query.month) }),
  )

  server.get(
    '/api/accounting/month-close/package.zip',
    { preHandler: [app.authenticate], schema: { querystring: MonthCloseQuerySchema } },
    async (req, reply) => {
      const pkg = await monthClose.buildMonthPackageZip(req.query.month)
      reply.header('Content-Disposition', `attachment; filename="${pkg.filename}"`)
      return reply.type('application/zip').send(pkg.buffer)
    },
  )

  server.post(
    '/api/accounting/month-close/archive-missing',
    {
      preHandler: [app.authenticate],
      schema: {
        body: MonthCloseArchiveMissingBodySchema,
        querystring: MonthCloseArchiveMissingQuerySchema,
      },
    },
    async (req) => {
      const month = req.body?.month ?? req.query.month
      return { success: true, data: await monthClose.archiveMissingForMonth(month) }
    },
  )

  server.post(
    '/api/accounting/month-close/fulfill-expected',
    { preHandler: [app.authenticate], schema: { body: FulfillExpectedBodySchema } },
    async (req, reply) => {
      try {
        const record = await monthClose.fulfillExpectedRow(req.body, req.me.id)
        return reply.code(201).send({ success: true, data: record })
      } catch (err) {
        if (err instanceof service.InvalidPdfUploadError) {
          return fail(reply, 400, 'INVALID_PDF_UPLOAD')
        }
        if (err instanceof service.DuplicateDocumentNumberError) {
          return fail(reply, 409, 'DUPLICATE_DOCUMENT_NUMBER', { message: err.message })
        }
        throw err
      }
    },
  )

  server.put(
    '/api/accounting/month-close/status',
    { preHandler: [app.authenticate], schema: { body: MonthCloseStatusBodySchema } },
    async (req) => ({
      success: true,
      data: await monthClose.setMonthClosureStatus(
        req.body.month,
        req.body.closed,
        req.body.note,
        req.me.id,
      ),
    }),
  )

  // ── Supplier email import & rules ──────────────────────────────────────────

  server.get(
    '/api/accounting/email-import/prefill',
    { preHandler: [app.authenticate], schema: { querystring: PrefillFromEmailQuerySchema } },
    async (req, reply) => {
      try {
        const data = await supplierEmail.prefillFromEmailAttachment(
          req.me,
          req.query.messageId,
          req.query.attachmentId,
        )
        return { success: true, data }
      } catch (err) {
        if (err instanceof supplierEmail.SupplierEmailNotFoundError) {
          return fail(reply, 404, 'EMAIL_MESSAGE_NOT_FOUND')
        }
        throw err
      }
    },
  )

  server.post(
    '/api/accounting/email-import',
    { preHandler: [app.authenticate], schema: { body: ImportFromEmailBodySchema } },
    async (req, reply) => {
      try {
        const canManageRules =
          req.me.role?.kind === 'admin' || req.me.features.includes('facturi.setari')
        const data = await supplierEmail.importInvoiceFromEmail(req.me, req.body, canManageRules)
        return { success: true, data }
      } catch (err) {
        if (err instanceof supplierEmail.SupplierEmailNotFoundError) {
          return fail(reply, 404, 'EMAIL_MESSAGE_NOT_FOUND')
        }
        if (err instanceof supplierEmail.SupplierEmailBadRequestError) {
          return fail(reply, 400, 'INVALID_PDF_UPLOAD')
        }
        if (err instanceof service.DuplicateDocumentNumberError) {
          return fail(reply, 409, 'DUPLICATE_DOCUMENT_NUMBER', { message: err.message })
        }
        throw err
      }
    },
  )

  server.get(
    '/api/accounting/supplier-rules',
    { preHandler: [app.authenticate] },
    async () => ({ success: true, data: await supplierEmail.listSupplierRules() }),
  )

  server.post(
    '/api/accounting/supplier-rules',
    { preHandler: [app.authenticate], schema: { body: SupplierRuleCreateSchema } },
    async (req, reply) => {
      const rule = await supplierEmail.createSupplierRule(req.body, req.me.id)
      return reply.code(201).send({ success: true, data: rule })
    },
  )

  server.patch(
    '/api/accounting/supplier-rules/:id',
    {
      preHandler: [app.authenticate],
      schema: { params: SupplierRuleIdParamsSchema, body: SupplierRuleUpdateSchema },
    },
    async (req, reply) => {
      const rule = await supplierEmail.updateSupplierRule(req.params.id, req.body, req.me.id)
      if (!rule) return fail(reply, 404, 'SUPPLIER_RULE_NOT_FOUND')
      return { success: true, data: rule }
    },
  )

  server.delete(
    '/api/accounting/supplier-rules/:id',
    { preHandler: [app.authenticate], schema: { params: SupplierRuleIdParamsSchema } },
    async (req, reply) => {
      const rule = await supplierEmail.deleteSupplierRule(req.params.id)
      if (!rule) return fail(reply, 404, 'SUPPLIER_RULE_NOT_FOUND')
      return { success: true, data: rule }
    },
  )

  server.post(
    '/api/accounting/supplier-rules/backfill',
    { preHandler: [app.authenticate], schema: { body: SupplierRuleBackfillSchema } },
    async (req) => ({
      success: true,
      data: await supplierEmail.backfillSupplierEmailRules(req.body),
    }),
  )
}
