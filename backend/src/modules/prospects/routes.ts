import multipart from '@fastify/multipart'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { importProspects } from './import-service.js'
import {
  BulkProspectIdsSchema,
  CreateProspectSchema,
  CreateProspectStatusSchema,
  ImportProspectsSchema,
  ListProspectsQuerySchema,
  PromoteProspectSchema,
  ReorderProspectStatusesSchema,
  UpdateProspectSchema,
  UpdateProspectStatusSchema,
  UpdateScoringConfigSchema,
} from './schema.js'
import * as service from './service.js'

const MAX_CSV_SIZE = 10 * 1024 * 1024 // 10MB — export de firme, nu fișiere media

export async function prospectsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_CSV_SIZE, files: 1 } })

  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get(
    '/api/prospects',
    { preHandler: [app.authenticate], schema: { querystring: ListProspectsQuerySchema } },
    async (req) => {
      const rows = await service.listProspects(req.query)
      return { success: true, data: rows }
    },
  )

  server.get('/api/prospects/scoring-config', { preHandler: [app.authenticate] }, async () => {
    const config = await service.getScoringConfig()
    return { success: true, data: config }
  })

  server.put(
    '/api/prospects/scoring-config',
    { preHandler: [app.authenticate], schema: { body: UpdateScoringConfigSchema } },
    async (req) => {
      const config = await service.updateScoringConfig(req.body)
      const recalculated = await service.recalculateAllScores()
      return { success: true, data: { config, recalculated } }
    },
  )

  server.get('/api/prospects/statuses', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listProspectStatuses() }
  })

  server.post(
    '/api/prospects/statuses',
    { preHandler: [app.authenticate], schema: { body: CreateProspectStatusSchema } },
    async (req, reply) => {
      try {
        const row = await service.createProspectStatus(req.body)
        return reply.code(201).send({ success: true, data: row })
      } catch (err) {
        if (err instanceof service.ProspectStatusKeyTakenError) return reply.code(409).send({ success: false, error: err.message })
        throw err
      }
    },
  )

  server.post(
    '/api/prospects/statuses/reorder',
    { preHandler: [app.authenticate], schema: { body: ReorderProspectStatusesSchema } },
    async (req, reply) => {
      try {
        const rows = await service.reorderProspectStatuses(req.body.orderedIds)
        return { success: true, data: rows }
      } catch (err) {
        if (err instanceof service.InvalidProspectStatusError) return reply.code(400).send({ success: false, error: err.message })
        throw err
      }
    },
  )

  server.patch(
    '/api/prospects/statuses/:id',
    { preHandler: [app.authenticate], schema: { body: UpdateProspectStatusSchema } },
    async (req, reply) => {
      const row = await service.updateProspectStatus((req.params as { id: string }).id, req.body)
      if (!row) return reply.code(404).send({ success: false, error: 'Status inexistent' })
      return { success: true, data: row }
    },
  )

  server.delete('/api/prospects/statuses/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const row = await service.deleteProspectStatus((req.params as { id: string }).id)
      if (!row) return reply.code(404).send({ success: false, error: 'Status inexistent' })
      return { success: true }
    } catch (err) {
      if (err instanceof service.ProspectStatusInUseError) {
        return reply.code(409).send({ success: false, error: err.message, count: err.count })
      }
      throw err
    }
  })

  // multipart/form-data (câmp "file") SAU JSON { csv, source } — formularul din UI trimite fișier
  // brut, dar rămâne util să poți lipi CSV direct (ex. curl/testare).
  server.post('/api/prospects/import', { preHandler: [app.authenticate] }, async (req, reply) => {
    const contentType = req.headers['content-type'] ?? ''
    let csvText: string
    let source: string | undefined

    if (contentType.includes('multipart/form-data')) {
      const data = await req.file()
      if (!data) return reply.code(400).send({ success: false, error: 'Fișier CSV lipsă' })
      const buffer = await data.toBuffer()
      if (data.file.truncated) return reply.code(413).send({ success: false, error: 'Fișier prea mare (peste 10MB)' })
      csvText = buffer.toString('utf-8')
      const sourceField = data.fields?.source
      source = sourceField && 'value' in sourceField ? String(sourceField.value) : data.filename
    } else {
      const parsed = ImportProspectsSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(400).send({ success: false, error: 'Body invalid — trimite { csv, source? }' })
      csvText = parsed.data.csv
      source = parsed.data.source
    }

    try {
      const result = await importProspects(csvText, source)
      return { success: true, data: result }
    } catch (err) {
      return reply.code(400).send({ success: false, error: `Import eșuat: ${String(err)}` })
    }
  })

  server.post(
    '/api/prospects',
    { preHandler: [app.authenticate], schema: { body: CreateProspectSchema } },
    async (req, reply) => {
      const row = await service.createProspect(req.body)
      return reply.code(201).send({ success: true, data: row })
    },
  )

  server.patch(
    '/api/prospects/:id',
    { preHandler: [app.authenticate], schema: { body: UpdateProspectSchema } },
    async (req, reply) => {
      try {
        const row = await service.updateProspect((req.params as { id: string }).id, req.body)
        if (!row) return reply.code(404).send({ success: false, error: 'Prospect inexistent' })
        return { success: true, data: row }
      } catch (err) {
        if (err instanceof service.InvalidProspectStatusError) return reply.code(400).send({ success: false, error: err.message })
        throw err
      }
    },
  )

  server.delete('/api/prospects/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const row = await service.deleteProspect((req.params as { id: string }).id)
    if (!row) return reply.code(404).send({ success: false, error: 'Prospect inexistent' })
    return { success: true }
  })

  server.post('/api/prospects/:id/archive', { preHandler: [app.authenticate] }, async (req, reply) => {
    const row = await service.archiveProspect((req.params as { id: string }).id)
    if (!row) return reply.code(404).send({ success: false, error: 'Prospect inexistent' })
    return { success: true, data: row }
  })

  server.post('/api/prospects/:id/unarchive', { preHandler: [app.authenticate] }, async (req, reply) => {
    const row = await service.unarchiveProspect((req.params as { id: string }).id)
    if (!row) return reply.code(404).send({ success: false, error: 'Prospect inexistent' })
    return { success: true, data: row }
  })

  server.post(
    '/api/prospects/archive-bulk',
    { preHandler: [app.authenticate], schema: { body: BulkProspectIdsSchema } },
    async (req) => {
      const rows = await service.archiveProspects(req.body.ids)
      return { success: true, data: { archived: rows.length } }
    },
  )

  server.post(
    '/api/prospects/unarchive-bulk',
    { preHandler: [app.authenticate], schema: { body: BulkProspectIdsSchema } },
    async (req) => {
      const rows = await service.unarchiveProspects(req.body.ids)
      return { success: true, data: { unarchived: rows.length } }
    },
  )

  server.post(
    '/api/prospects/:id/promote',
    { preHandler: [app.authenticate], schema: { body: PromoteProspectSchema } },
    async (req, reply) => {
      try {
        const row = await service.promoteProspect((req.params as { id: string }).id, req.body)
        if (!row) return reply.code(404).send({ success: false, error: 'Prospect inexistent' })
        return { success: true, data: row }
      } catch (err) {
        return reply.code(400).send({ success: false, error: String(err instanceof Error ? err.message : err) })
      }
    },
  )
}
