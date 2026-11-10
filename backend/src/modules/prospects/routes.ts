import multipart from '@fastify/multipart'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { importProspects } from './import-service.js'
import {
  AggregateQuerySchema,
  BulkProspectIdsSchema,
  BulkUpdateSchema,
  CompanyLookupQuerySchema,
  CountQuerySchema,
  CreateProspectSchema,
  CreateProspectStatusSchema,
  ImportProspectsSchema,
  ListProspectsQuerySchema,
  NeighborsQuerySchema,
  PromoteProspectSchema,
  ReorderProspectStatusesSchema,
  UpdateProspectSchema,
  UpdateProspectStatusSchema,
  UpdateScoringConfigSchema,
} from './schema.js'
import * as service from './service.js'
import { tr } from '../../shared/lib/i18n.js'
import { ProspectNotYoursError } from '../../shared/lib/prospect-access.js'
import { getCompany } from '../../shared/lib/company.js'
import { getCountryPack } from '../../countries/index.js'
import { FilterOpError } from './filters.js'

type Id = { id: string }

/** The prospect errors every route maps the same way. Anything else goes to the app handler. */
export function prospectErrorReply(reply: FastifyReply, err: unknown) {
  if (err instanceof ProspectNotYoursError) {
    const error = err.ownerName ? tr('errors.prospects.notYours', { owner: err.ownerName }) : tr('errors.prospects.notYoursFree')
    return reply.code(403).send({ success: false, error, code: err.code, ownerName: err.ownerName })
  }
  if (err instanceof service.ProspectExistsError) {
    return reply.code(409).send({ success: false, error: tr('errors.prospects.exists', { name: err.existing.name }), code: err.code, existing: err.existing })
  }
  if (err instanceof service.LostReasonRequiredError) return reply.code(400).send({ success: false, error: err.message, code: err.code })
  if (err instanceof service.InvalidProspectStatusError || err instanceof FilterOpError) {
    return reply.code(400).send({ success: false, error: err.message })
  }
  throw err
}

const MAX_CSV_SIZE = 10 * 1024 * 1024 // 10MB — export de firme, nu fișiere media

export async function prospectsRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_CSV_SIZE, files: 1 } })

  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get('/api/prospects', { preHandler: [app.authenticate], schema: { querystring: ListProspectsQuerySchema } }, async (req, reply) => {
    try {
      return { success: true, data: await service.listProspects(req.me, req.query) }
    } catch (err) {
      return prospectErrorReply(reply, err)
    }
  })

  server.get('/api/prospects/count', { preHandler: [app.authenticate], schema: { querystring: CountQuerySchema } }, async (req, reply) => {
    try {
      return { success: true, data: { total: await service.countProspects(req.me, req.query) } }
    } catch (err) {
      // Over the 2s budget the client shows "over 1,000" instead of a number.
      if (String(err).includes('statement timeout')) return { success: true, data: { total: null } }
      return prospectErrorReply(reply, err)
    }
  })

  server.get('/api/prospects/aggregate', { preHandler: [app.authenticate], schema: { querystring: AggregateQuerySchema } }, async (req, reply) => {
    try {
      return { success: true, data: await service.aggregateProspects(req.me, req.query, req.query.field, req.query.fn) }
    } catch (err) {
      return prospectErrorReply(reply, err)
    }
  })

  server.get('/api/prospects/company-lookup', { preHandler: [app.authenticate], schema: { querystring: CompanyLookupQuerySchema } }, async (req, reply) => {
    const pack = getCountryPack((await getCompany()).country)
    if (!pack.lookupCompany) return reply.code(404).send({ success: false, error: tr('errors.prospects.lookupUnavailable') })
    const existing = await service.findByCif(req.query.cui)
    try {
      const company = await pack.lookupCompany(req.query.cui)
      return { success: true, data: { company, existing: existing ? { id: existing.id, name: existing.name } : null } }
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode === 503 ? 503 : 400
      return reply.code(status).send({ success: false, error: err instanceof Error ? err.message : tr('errors.prospects.lookupUnavailable') })
    }
  })

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
      if (!row) return reply.code(404).send({ success: false, error: tr('errors.prospects.statusNotFound') })
      return { success: true, data: row }
    },
  )

  server.delete('/api/prospects/statuses/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const row = await service.deleteProspectStatus((req.params as { id: string }).id)
      if (!row) return reply.code(404).send({ success: false, error: tr('errors.prospects.statusNotFound') })
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
      if (!data) return reply.code(400).send({ success: false, error: tr('errors.prospects.csvMissing') })
      const buffer = await data.toBuffer()
      if (data.file.truncated) return reply.code(413).send({ success: false, error: tr('errors.prospects.fileTooLarge') })
      csvText = buffer.toString('utf-8')
      const sourceField = data.fields?.source
      source = sourceField && 'value' in sourceField ? String(sourceField.value) : data.filename
    } else {
      const parsed = ImportProspectsSchema.safeParse(req.body)
      if (!parsed.success) return reply.code(400).send({ success: false, error: tr('errors.prospects.invalidBody') })
      csvText = parsed.data.csv
      source = parsed.data.source
    }

    try {
      const result = await importProspects(csvText, source)
      return { success: true, data: result }
    } catch (err) {
      return reply.code(400).send({ success: false, error: tr('errors.prospects.importFailed', { err: String(err) }) })
    }
  })

  server.post('/api/prospects', { preHandler: [app.authenticate], schema: { body: CreateProspectSchema } }, async (req, reply) => {
    try {
      const row = await service.createProspect(req.me, req.body)
      return reply.code(201).send({ success: true, data: row })
    } catch (err) {
      return prospectErrorReply(reply, err)
    }
  })

  server.get('/api/prospects/assignees', { preHandler: [app.authenticate] }, async () => {
    return { success: true, data: await service.listAssignees() }
  })

  server.patch('/api/prospects/bulk', { preHandler: [app.authenticate], schema: { body: BulkUpdateSchema } }, async (req, reply) => {
    try {
      return { success: true, data: await service.bulkUpdate(req.me, req.body) }
    } catch (err) {
      return prospectErrorReply(reply, err)
    }
  })

  server.get('/api/prospects/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const row = await service.getProspectSheet(req.me, (req.params as Id).id)
    if (!row) return reply.code(404).send({ success: false, error: tr('errors.prospects.notFound') })
    return { success: true, data: row }
  })

  server.get('/api/prospects/:id/neighbors', { preHandler: [app.authenticate], schema: { querystring: NeighborsQuerySchema } }, async (req, reply) => {
    const data = await service.prospectNeighbors(req.me, (req.params as Id).id, req.query)
    if (!data) return reply.code(404).send({ success: false, error: tr('errors.prospects.notFound') })
    return { success: true, data }
  })

  server.get('/api/prospects/:id/timeline', { preHandler: [app.authenticate] }, async (req, reply) => {
    const cursor = (req.query as { cursor?: string }).cursor
    const data = await service.prospectTimeline(req.me, (req.params as Id).id, cursor && !Number.isNaN(Date.parse(cursor)) ? cursor : undefined)
    if (!data) return reply.code(404).send({ success: false, error: tr('errors.prospects.notFound') })
    return { success: true, data }
  })

  server.patch('/api/prospects/:id', { preHandler: [app.authenticate], schema: { body: UpdateProspectSchema } }, async (req, reply) => {
    try {
      const row = await service.updateProspect(req.me, (req.params as Id).id, req.body)
      if (!row) return reply.code(404).send({ success: false, error: tr('errors.prospects.notFound') })
      return { success: true, data: row }
    } catch (err) {
      return prospectErrorReply(reply, err)
    }
  })

  server.delete('/api/prospects/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    try {
      const row = await service.deleteProspect(req.me, (req.params as Id).id)
      if (!row) return reply.code(404).send({ success: false, error: tr('errors.prospects.notFound') })
      return { success: true }
    } catch (err) {
      return prospectErrorReply(reply, err)
    }
  })

  server.post('/api/prospects/:id/archive', { preHandler: [app.authenticate] }, async (req, reply) => {
    const [id] = await service.archiveProspects(req.me, [(req.params as Id).id])
    if (!id) return reply.code(404).send({ success: false, error: tr('errors.prospects.notFound') })
    return { success: true, data: { id } }
  })

  server.post('/api/prospects/:id/unarchive', { preHandler: [app.authenticate] }, async (req, reply) => {
    const [id] = await service.unarchiveProspects(req.me, [(req.params as Id).id])
    if (!id) return reply.code(404).send({ success: false, error: tr('errors.prospects.notFound') })
    return { success: true, data: { id } }
  })

  server.post('/api/prospects/archive-bulk', { preHandler: [app.authenticate], schema: { body: BulkProspectIdsSchema } }, async (req) => {
    const rows = await service.archiveProspects(req.me, req.body.ids)
    return { success: true, data: { archived: rows.length } }
  })

  server.post('/api/prospects/unarchive-bulk', { preHandler: [app.authenticate], schema: { body: BulkProspectIdsSchema } }, async (req) => {
    const rows = await service.unarchiveProspects(req.me, req.body.ids)
    return { success: true, data: { unarchived: rows.length } }
  })

  server.post('/api/prospects/:id/promote', { preHandler: [app.authenticate], schema: { body: PromoteProspectSchema } }, async (req, reply) => {
    // Promoting creates a billing client, so it needs that right as well.
    if (!req.me.features.includes('facturi.clienti')) return reply.code(403).send({ success: false, error: tr('errors.prospects.promoteNeedsClients') })
    try {
      const row = await service.promoteProspect(req.me, (req.params as Id).id, req.body)
      if (!row) return reply.code(404).send({ success: false, error: tr('errors.prospects.notFound') })
      return { success: true, data: row }
    } catch (err) {
      if (err instanceof ProspectNotYoursError) return prospectErrorReply(reply, err)
      return reply.code(400).send({ success: false, error: String(err instanceof Error ? err.message : err) })
    }
  })
}
