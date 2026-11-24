import multipart from '@fastify/multipart'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { readDocument } from '../../shared/lib/storage.js'
import * as service from './service.js'
import * as templatesService from './templates-service.js'
import * as registryService from './registry-service.js'
import * as numbersService from './numbers.js'
import * as settingsService from './settings-service.js'
import { registerSigningRoutes } from './signing-routes.js'
import { z } from 'zod'
import {
  CreateContractSchema,
  CustomTemplateSchema,
  IdParamsSchema,
  NumbersQuerySchema,
  RegistryQuerySchema,
  ReserveNumberSchema,
  SeriesSchema,
  UpdateContractSchema,
  UploadContractMetaSchema,
} from './registry-schema.js'
import {
  AddendumIdParamsSchema,
  ClientIdParamsSchema,
  CreateAddendumSchema,
  DocumentIdParamsSchema,
  GenerateDocumentSchema,
  MarkDocumentSignedSchema,
} from './schema.js'
import { ContractTermsUpdateSchema, TemplateKeyParamsSchema, TemplateUpdateSchema } from './templates-schema.js'
import { fail, HttpError } from '../../shared/lib/http-error.js'
import { tr } from '../../shared/lib/i18n.js'

const MAX_SIGNED_PDF_SIZE = 50 * 1024 * 1024 // 50MB — document contractual, nu streaming
const MAX_REGISTRY_PDF_SIZE = 20 * 1024 * 1024

export async function contractsRoutes(app: FastifyInstance) {
  // Scoped to this plugin's routes (Fastify encapsulation, same pattern as archive/routes.ts).
  await app.register(multipart, { limits: { fileSize: MAX_SIGNED_PDF_SIZE, files: 1 } })

  const server = app.withTypeProvider<ZodTypeProvider>()
  registerSigningRoutes(app)

  // ── Registry: every contract of the company, visible per owner (admin sees all) ──────────────

  server.get(
    '/api/contracts/registry',
    { preHandler: [app.authenticate], schema: { querystring: RegistryQuerySchema } },
    async (req) => ({ success: true, data: await registryService.listRegistry(req.me, req.query) }),
  )

  server.get(
    '/api/contracts/registry/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req) => ({ success: true, data: await registryService.getContract(req.me, req.params.id) }),
  )

  server.post(
    '/api/contracts/registry',
    { preHandler: [app.authenticate], schema: { body: CreateContractSchema } },
    async (req, reply) => {
      try {
        return reply.code(201).send({ success: true, data: await registryService.createFromTemplate(req.me, req.body) })
      } catch (err) {
        if (err instanceof HttpError) throw err
        req.log.warn({ err }, 'contract generation failed')
        return fail(reply, 400, 'CONTRACT_GENERATE_FAILED')
      }
    },
  )

  // multipart/form-data: 'meta' (JSON text) has to come before 'file' in the form, because
  // @fastify/multipart reads the stream in order and data.fields holds only what came before the file.
  server.post('/api/contracts/registry/upload', { preHandler: [app.authenticate] }, async (req, reply) => {
    const data = await req.file()
    if (!data) return fail(reply, 400, 'FILE_MISSING', { message: tr('errors.files.missing') })
    const metaField = data.fields.meta
    let metaRaw: unknown
    try {
      metaRaw = metaField && 'value' in metaField ? JSON.parse(String(metaField.value)) : undefined
    } catch {
      return fail(reply, 400, 'VALIDATION_FAILED')
    }
    const meta = UploadContractMetaSchema.safeParse(metaRaw)
    if (!meta.success) return fail(reply, 400, 'VALIDATION_FAILED')
    if (data.mimetype !== 'application/pdf') {
      return fail(reply, 415, 'UNSUPPORTED_MEDIA_TYPE', { message: tr('errors.contracts.pdfOnly') })
    }
    const buffer = await data.toBuffer()
    if (data.file.truncated || buffer.length > MAX_REGISTRY_PDF_SIZE) {
      return fail(reply, 413, 'PAYLOAD_TOO_LARGE', { message: tr('errors.contracts.fileTooLarge') })
    }
    return reply.code(201).send({ success: true, data: await registryService.uploadContract(req.me, meta.data, buffer) })
  })

  server.patch(
    '/api/contracts/registry/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema, body: UpdateContractSchema } },
    async (req) => ({ success: true, data: await registryService.updateContract(req.me, req.params.id, req.body) }),
  )

  server.delete(
    '/api/contracts/registry/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req) => {
      await registryService.deleteDraft(req.me, req.params.id)
      return { success: true }
    },
  )

  // ── Numbers and series ───────────────────────────────────────────────────────────────────────

  server.get(
    '/api/contracts/numbers',
    { preHandler: [app.authenticate], schema: { querystring: NumbersQuerySchema } },
    async (req) => ({ success: true, data: await numbersService.listNumbers(req.query.seriesId) }),
  )

  server.post(
    '/api/contracts/numbers/reservations',
    { preHandler: [app.authenticate], schema: { body: ReserveNumberSchema } },
    async (req, reply) => reply.code(201).send({ success: true, data: await numbersService.reserveNumber(req.body) }),
  )

  server.delete(
    '/api/contracts/numbers/reservations/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      if (!(await numbersService.deleteReservation(req.params.id))) return fail(reply, 404, 'CONTRACT_NUMBER_NOT_FOUND')
      return { success: true }
    },
  )

  server.get('/api/contracts/series', { preHandler: [app.authenticate] }, async () => ({
    success: true,
    data: await numbersService.listSeries(),
  }))

  server.post(
    '/api/contracts/series',
    { preHandler: [app.authenticate], schema: { body: SeriesSchema } },
    async (req, reply) => reply.code(201).send({ success: true, data: await numbersService.createSeries(req.body) }),
  )

  server.put(
    '/api/contracts/series/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema, body: SeriesSchema } },
    async (req) => ({ success: true, data: await numbersService.updateSeries(req.params.id, req.body) }),
  )

  // ── Notice settings ──────────────────────────────────────────────────────────────────────────

  server.get('/api/contracts/settings', { preHandler: [app.authenticate] }, async () => ({
    success: true,
    data: await settingsService.getNoticeSettings(),
  }))

  server.put(
    '/api/contracts/settings',
    { preHandler: [app.authenticate], schema: { body: z.object({ leadDays: z.number().int().min(1).max(90) }) } },
    async (req) => ({ success: true, data: await settingsService.updateNoticeSettings(req.body) }),
  )

  // Counts for the settings tab headers; templates are seeded on first read, so list them through the service.
  server.get('/api/contracts/settings-summary', { preHandler: [app.authenticate] }, async () => {
    const [numbers, templates] = await Promise.all([numbersService.listNumbers(), templatesService.listTemplates()])
    const reservedNumbers = numbers.items.filter((item) => item.kind === 'reserved').length
    return { success: true, data: { reservedNumbers, templates: templates.length } }
  })

  server.get(
    '/api/contracts/clients/:clientId/documents',
    { preHandler: [app.authenticate], schema: { params: ClientIdParamsSchema } },
    async (req) => {
      return { success: true, data: await service.listDocuments(req.params.clientId) }
    },
  )

  server.post(
    '/api/contracts/clients/:clientId/documents',
    { preHandler: [app.authenticate], schema: { params: ClientIdParamsSchema, body: GenerateDocumentSchema } },
    async (req, reply) => {
      try {
        const row = await service.generateDocument(req.params.clientId, req.body.docType)
        return reply.code(201).send({ success: true, data: row })
      } catch (err) {
        if (err instanceof HttpError) throw err
        req.log.warn({ err }, 'contract document generation failed')
        return fail(reply, 400, 'CONTRACT_GENERATE_FAILED')
      }
    },
  )

  server.get(
    '/api/contracts/clients/:clientId/preview',
    { preHandler: [app.authenticate], schema: { params: ClientIdParamsSchema, querystring: GenerateDocumentSchema } },
    async (req, reply) => {
      try {
        const pdf = await service.previewDocument(req.params.clientId, req.query.docType)
        reply.header('Content-Disposition', 'inline; filename="simulare.pdf"')
        return reply.type('application/pdf').send(pdf)
      } catch (err) {
        if (err instanceof HttpError) throw err
        req.log.warn({ err }, 'contract preview failed')
        return fail(reply, 400, 'CONTRACT_PREVIEW_FAILED')
      }
    },
  )

  server.patch(
    '/api/contracts/documents/:id',
    { preHandler: [app.authenticate], schema: { params: DocumentIdParamsSchema, body: MarkDocumentSignedSchema } },
    async (req, reply) => {
      const row = await service.markDocumentSigned(req.params.id, req.body.isSigned)
      if (!row) return fail(reply, 404, 'CONTRACT_DOCUMENT_NOT_FOUND')
      return { success: true, data: row }
    },
  )

  server.get(
    '/api/contracts/documents/:id/pdf',
    { preHandler: [app.authenticate], schema: { params: DocumentIdParamsSchema } },
    async (req, reply) => {
      const doc = await registryService.getVisibleDocument(req.me, req.params.id)
      if (!doc) return fail(reply, 404, 'CONTRACT_DOCUMENT_NOT_FOUND')
      const content = await readDocument(doc.pdfStoragePath)
      reply.header('Content-Disposition', `attachment; filename="${doc.docType}_${doc.id.slice(0, 8)}.pdf"`)
      return reply.type('application/pdf').send(content)
    },
  )

  server.get(
    '/api/contracts/clients/:clientId/addenda',
    { preHandler: [app.authenticate], schema: { params: ClientIdParamsSchema } },
    async (req) => {
      return { success: true, data: await service.listAddenda(req.params.clientId) }
    },
  )

  server.post(
    '/api/contracts/clients/:clientId/addenda',
    { preHandler: [app.authenticate], schema: { params: ClientIdParamsSchema, body: CreateAddendumSchema } },
    async (req, reply) => {
      const row = await service.createAddendum(req.params.clientId, req.body)
      return reply.code(201).send({ success: true, data: row })
    },
  )

  server.post(
    '/api/contracts/addenda/:id/document',
    { preHandler: [app.authenticate], schema: { params: AddendumIdParamsSchema } },
    async (req, reply) => {
      try {
        const row = await service.generateAddendumDocument(req.params.id)
        return reply.code(201).send({ success: true, data: row })
      } catch (err) {
        if (err instanceof HttpError) throw err
        req.log.warn({ err }, 'addendum document generation failed')
        return fail(reply, 400, 'CONTRACT_GENERATE_FAILED')
      }
    },
  )

  server.get(
    '/api/contracts/clients/:clientId/info',
    { preHandler: [app.authenticate], schema: { params: ClientIdParamsSchema } },
    async (req) => {
      return { success: true, data: await service.getContractInfo(req.params.clientId) }
    },
  )

  // ── Editable templates and commercial terms ─────────────────────────────────────────────────

  server.get('/api/contracts/templates', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await templatesService.listTemplates() }
  })

  server.post(
    '/api/contracts/templates',
    { preHandler: [app.authenticate], schema: { body: CustomTemplateSchema } },
    async (req, reply) => reply.code(201).send({ success: true, data: await templatesService.createCustomTemplate(req.body) }),
  )

  server.put(
    '/api/contracts/templates/custom/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema, body: CustomTemplateSchema } },
    async (req) => ({ success: true, data: await templatesService.updateCustomTemplate(req.params.id, req.body) }),
  )

  server.delete(
    '/api/contracts/templates/custom/:id',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req) => {
      await templatesService.deleteCustomTemplate(req.params.id)
      return { success: true }
    },
  )

  server.get(
    '/api/contracts/templates/custom/:id/preview',
    { preHandler: [app.authenticate], schema: { params: IdParamsSchema } },
    async (req, reply) => {
      const pdf = await registryService.previewCustomTemplate(req.params.id)
      reply.header('Content-Disposition', 'attachment; filename="sablon.pdf"')
      return reply.type('application/pdf').send(pdf)
    },
  )

  server.put(
    '/api/contracts/templates/:key',
    { preHandler: [app.authenticate], schema: { params: TemplateKeyParamsSchema, body: TemplateUpdateSchema } },
    async (req) => {
      const row = await templatesService.updateTemplate(req.params.key, req.body.bodyHtml)
      return { success: true, data: row }
    },
  )

  server.get(
    '/api/contracts/templates/:key/blank',
    { preHandler: [app.authenticate], schema: { params: TemplateKeyParamsSchema } },
    async (req, reply) => {
      try {
        const pdf = await service.blankDocumentPdf(req.params.key)
        reply.header('Content-Disposition', `attachment; filename="${req.params.key}-gol.pdf"`)
        return reply.type('application/pdf').send(pdf)
      } catch (err) {
        if (err instanceof HttpError) throw err
        req.log.warn({ err }, 'blank contract copy failed')
        return fail(reply, 400, 'CONTRACT_BLANK_FAILED')
      }
    },
  )

  server.post(
    '/api/contracts/templates/:key/restore',
    { preHandler: [app.authenticate], schema: { params: TemplateKeyParamsSchema } },
    async (req) => {
      const row = await templatesService.restoreTemplate(req.params.key)
      return { success: true, data: row }
    },
  )

  server.get('/api/contracts/terms', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await templatesService.getContractTerms() }
  })

  server.put(
    '/api/contracts/terms',
    { preHandler: [app.authenticate], schema: { body: ContractTermsUpdateSchema } },
    async (req) => {
      return { success: true, data: await templatesService.updateContractTerms(req.body) }
    },
  )

  // ── Digital signature: the signed PDF comes back as a new version ───────────────────────────

  server.post(
    '/api/contracts/documents/:id/signed',
    { preHandler: [app.authenticate], schema: { params: DocumentIdParamsSchema } },
    async (req, reply) => {
      // Someone else's confidential contract answers 404 before anything is written.
      if (!(await registryService.getVisibleDocument(req.me, req.params.id))) return fail(reply, 404, 'CONTRACT_DOCUMENT_NOT_FOUND')
      const data = await req.file()
      if (!data) return fail(reply, 400, 'FILE_MISSING', { message: tr('errors.files.missing') })
      if (data.mimetype !== 'application/pdf') {
        return fail(reply, 415, 'UNSUPPORTED_MEDIA_TYPE', { message: tr('errors.contracts.pdfOnly') })
      }
      const buffer = await data.toBuffer()
      if (data.file.truncated) {
        return fail(reply, 413, 'PAYLOAD_TOO_LARGE', { message: tr('errors.contracts.fileTooLarge') })
      }
      try {
        const row = await service.uploadSignedDocument(req.params.id, buffer)
        return reply.code(201).send({ success: true, data: row })
      } catch (err) {
        if (err instanceof HttpError) throw err
        req.log.warn({ err }, 'signed contract upload failed')
        return fail(reply, 400, 'CONTRACT_UPLOAD_FAILED')
      }
    },
  )
}
