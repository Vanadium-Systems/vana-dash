import multipart from '@fastify/multipart'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { readDocument } from '../../shared/lib/storage.js'
import * as service from './service.js'
import * as templatesService from './templates-service.js'
import * as reservedNumbers from './reserved-numbers-service.js'
import {
  AddendumIdParamsSchema,
  ClientIdParamsSchema,
  CreateAddendumSchema,
  DocumentIdParamsSchema,
  GenerateDocumentSchema,
  MarkDocumentSignedSchema,
  ReservedNumbersSchema,
  SignatureRectSchema,
} from './schema.js'
import { ContractTermsUpdateSchema, TemplateKeyParamsSchema, TemplateUpdateSchema } from './templates-schema.js'
import { tr } from '../../shared/lib/i18n.js'

const MAX_SIGNED_PDF_SIZE = 50 * 1024 * 1024 // 50MB — document contractual, nu streaming

export async function contractsRoutes(app: FastifyInstance) {
  // Scoped la rutele acestui plugin (encapsulare Fastify, pattern identic archive/routes.ts).
  await app.register(multipart, { limits: { fileSize: MAX_SIGNED_PDF_SIZE, files: 1 } })

  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get(
    '/api/contracts/clients/:clientId/documents',
    { preHandler: [app.authenticate], schema: { params: ClientIdParamsSchema } },
    async (req, reply) => {
      try {
        const rows = await service.listDocuments(req.params.clientId)
        return { success: true, data: rows }
      } catch (err) {
        return reply.code(404).send({ success: false, error: String(err instanceof Error ? err.message : err) })
      }
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
        return reply.code(400).send({ success: false, error: String(err instanceof Error ? err.message : err) })
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
        return reply.code(400).send({ success: false, error: String(err instanceof Error ? err.message : err) })
      }
    },
  )

  server.patch(
    '/api/contracts/documents/:id',
    { preHandler: [app.authenticate], schema: { params: DocumentIdParamsSchema, body: MarkDocumentSignedSchema } },
    async (req, reply) => {
      const row = await service.markDocumentSigned(req.params.id, req.body.isSigned)
      if (!row) return reply.code(404).send({ success: false, error: tr('errors.contracts.documentNotFound') })
      return { success: true, data: row }
    },
  )

  server.get(
    '/api/contracts/documents/:id/pdf',
    { preHandler: [app.authenticate], schema: { params: DocumentIdParamsSchema } },
    async (req, reply) => {
      const doc = await service.getDocument(req.params.id)
      if (!doc) return reply.code(404).send({ success: false, error: tr('errors.contracts.documentNotFound') })
      const content = await readDocument(doc.pdfStoragePath)
      reply.header('Content-Disposition', `attachment; filename="${doc.docType}_${doc.id.slice(0, 8)}.pdf"`)
      return reply.type('application/pdf').send(content)
    },
  )

  server.get(
    '/api/contracts/clients/:clientId/addenda',
    { preHandler: [app.authenticate], schema: { params: ClientIdParamsSchema } },
    async (req, reply) => {
      try {
        const rows = await service.listAddenda(req.params.clientId)
        return { success: true, data: rows }
      } catch (err) {
        return reply.code(404).send({ success: false, error: String(err instanceof Error ? err.message : err) })
      }
    },
  )

  server.post(
    '/api/contracts/clients/:clientId/addenda',
    { preHandler: [app.authenticate], schema: { params: ClientIdParamsSchema, body: CreateAddendumSchema } },
    async (req, reply) => {
      try {
        const row = await service.createAddendum(req.params.clientId, req.body)
        return reply.code(201).send({ success: true, data: row })
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err instanceof Error ? err.message : err) })
      }
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
        return reply.code(400).send({ success: false, error: String(err instanceof Error ? err.message : err) })
      }
    },
  )

  server.get(
    '/api/contracts/clients/:clientId/info',
    { preHandler: [app.authenticate], schema: { params: ClientIdParamsSchema } },
    async (req, reply) => {
      try {
        const row = await service.getContractInfo(req.params.clientId)
        return { success: true, data: row }
      } catch (err) {
        return reply.code(404).send({ success: false, error: String(err instanceof Error ? err.message : err) })
      }
    },
  )

  // ── Șabloane editabile + termeni comerciali (sprint de-hardcodare) ─────────────────────────

  server.get('/api/contracts/templates', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await templatesService.listTemplates() }
  })

  server.put(
    '/api/contracts/templates/:key',
    { preHandler: [app.authenticate], schema: { params: TemplateKeyParamsSchema, body: TemplateUpdateSchema } },
    async (req, reply) => {
      try {
        const row = await templatesService.updateTemplate(req.params.key, req.body.bodyHtml)
        return { success: true, data: row }
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err instanceof Error ? err.message : err) })
      }
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
        return reply.code(400).send({ success: false, error: String(err instanceof Error ? err.message : err) })
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

  // ── Numere rezervate (ocupate în afara dash-ului) ──────────────────────────────────────────

  server.get('/api/contracts/reserved-numbers', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await reservedNumbers.listReservedNumbers() }
  })

  server.put(
    '/api/contracts/reserved-numbers',
    { preHandler: [app.authenticate], schema: { body: ReservedNumbersSchema } },
    async (req, reply) => {
      try {
        return { success: true, data: await reservedNumbers.replaceReservedNumbers(req.body) }
      } catch (err) {
        if (err instanceof reservedNumbers.ReservedNumberDuplicateError) {
          return reply.code(400).send({ success: false, error: { code: 'RESERVED_NUMBER_DUPLICATE' } })
        }
        throw err
      }
    },
  )

  // ── Semnătură digitală — tab „Semnează" ────────────────────────────────────────────────────

  server.patch(
    '/api/contracts/documents/:id/signature-rect',
    { preHandler: [app.authenticate], schema: { params: DocumentIdParamsSchema, body: SignatureRectSchema } },
    async (req, reply) => {
      const row = await service.saveSignatureRect(req.params.id, req.body)
      if (!row) return reply.code(404).send({ success: false, error: tr('errors.contracts.documentNotFound') })
      return { success: true, data: row }
    },
  )

  server.get(
    '/api/contracts/documents/:id/sign-package',
    { preHandler: [app.authenticate], schema: { params: DocumentIdParamsSchema } },
    async (req, reply) => {
      try {
        const { buffer, fileName } = await service.buildSignPackage(req.params.id)
        reply.header('Content-Disposition', `attachment; filename="${fileName}"`)
        return reply.type('application/zip').send(buffer)
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err instanceof Error ? err.message : err) })
      }
    },
  )

  server.post(
    '/api/contracts/documents/:id/signed',
    { preHandler: [app.authenticate], schema: { params: DocumentIdParamsSchema } },
    async (req, reply) => {
      const data = await req.file()
      if (!data) return reply.code(400).send({ success: false, error: tr('errors.files.missing') })
      if (data.mimetype !== 'application/pdf') {
        return reply.code(400).send({ success: false, error: tr('errors.contracts.pdfOnly') })
      }
      const buffer = await data.toBuffer()
      if (data.file.truncated) {
        return reply.code(413).send({ success: false, error: tr('errors.contracts.fileTooLarge') })
      }
      try {
        const row = await service.uploadSignedDocument(req.params.id, buffer)
        return reply.code(201).send({ success: true, data: row })
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err instanceof Error ? err.message : err) })
      }
    },
  )
}
