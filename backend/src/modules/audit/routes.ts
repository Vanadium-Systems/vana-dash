import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { and, desc, eq, lt, type SQL } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { auditLog, users } from '../../shared/db/schema/index.js'
import { z } from 'zod'

// „Cine a făcut ce" (PLAN.md C2). Funcționalitatea `echipa.istoric` — nu „doar Vanadium":
// orice om din echipă vede istoricul, fiindcă toată povestea e despre obiectele comune.
//
// Paginare pe cursor pe `created_at`: lista crește continuu, iar cu offset s-ar sări rânduri
// la inserări între două pagini.

const AuditQuerySchema = z.object({
  entityType: z.string().max(60).optional(),
  entityId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().max(80).optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

export interface AuditListItem {
  id: string
  actor: { id: string; displayName: string | null } | null
  action: string
  entityType: string
  entityId: string | null
  changes: Record<string, [unknown, unknown]> | null
  createdAt: Date
}

export async function listAudit(query: z.infer<typeof AuditQuerySchema>): Promise<AuditListItem[]> {
  const conditions: SQL[] = []
  if (query.entityType) conditions.push(eq(auditLog.entityType, query.entityType))
  if (query.entityId) conditions.push(eq(auditLog.entityId, query.entityId))
  if (query.actorId) conditions.push(eq(auditLog.actorUserId, query.actorId))
  if (query.action) conditions.push(eq(auditLog.action, query.action))
  if (query.before) conditions.push(lt(auditLog.createdAt, new Date(query.before)))

  const rows = await db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      changes: auditLog.changes,
      createdAt: auditLog.createdAt,
      actorId: users.id,
      actorName: users.displayName,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(and(...conditions))
    .orderBy(desc(auditLog.createdAt))
    .limit(query.limit)

  return rows.map((row) => ({
    id: row.id,
    actor: row.actorId ? { id: row.actorId, displayName: row.actorName } : null,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    changes: (row.changes as Record<string, [unknown, unknown]>) ?? null,
    createdAt: row.createdAt,
  }))
}

export async function auditRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  server.get('/api/audit', { preHandler: [app.authenticate], schema: { querystring: AuditQuerySchema } }, async (req) => {
    return { success: true, data: await listAudit(req.query) }
  })
}
