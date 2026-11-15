import { and, desc, eq, lt, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { apiTokens, auditLog, prospects, users } from '../../shared/db/schema/index.js'
import { visibleProspectsWhere } from '../../shared/lib/prospect-access.js'
import type { SessionUser } from '../../shared/lib/session.js'
import type { AuditQuerySchema } from './schema.js'

export interface AuditListItem {
  id: string
  actor: { id: string; displayName: string | null } | null
  action: string
  entityType: string
  entityId: string | null
  changes: Record<string, [unknown, unknown]> | null
  viaToken: { id: string; name: string } | null
  createdAt: Date
}

// Rows about a prospect carry its contact values and name; they reach only people who see it.
// `entity_id` null (export / import summaries) is not tied to one prospect and stays.
function prospectRowsVisible(me: SessionUser): SQL {
  return sql`(${auditLog.entityType} <> 'prospect' OR ${auditLog.entityId} IS NULL
    OR EXISTS (SELECT 1 FROM ${prospects} WHERE ${prospects.id} = ${auditLog.entityId} AND ${visibleProspectsWhere(me)}))`
}

// A share row is for whoever gave it, whoever received it, and the managers of that area.
// Archive rows name the target in `changes.utilizator` ("level:userId" on add, the bare id on
// remove); calendar rows keep only the calendar owner (`entity_id`), the target is not recorded.
function shareRowsVisible(me: SessionUser): SQL {
  const mine = sql`${auditLog.actorUserId} = ${me.id}`
  const archiveManager = sql.raw(String(me.features.includes('arhiva.administrare')))
  const calendarManager = sql.raw(String(me.features.includes('calendar.administrare')))
  return sql`(
    (${auditLog.action} NOT IN ('arhiva.share.adaugat', 'arhiva.share.scos') OR ${archiveManager} OR ${mine}
      OR (${auditLog.changes}->'utilizator'->>0) = ${me.id}
      OR (${auditLog.changes}->'utilizator'->>1) LIKE ${'%:' + me.id})
    AND (${auditLog.action} NOT IN ('calendar.share.adaugat', 'calendar.share.scos') OR ${calendarManager} OR ${mine}
      OR ${auditLog.entityId} = ${me.id})
  )`
}

export async function listAudit(me: SessionUser, query: z.infer<typeof AuditQuerySchema>): Promise<AuditListItem[]> {
  const conditions: SQL[] = [prospectRowsVisible(me), shareRowsVisible(me)]
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
      tokenId: apiTokens.id,
      tokenName: apiTokens.name,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .leftJoin(apiTokens, eq(apiTokens.id, auditLog.apiTokenId))
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
    viaToken: row.tokenId ? { id: row.tokenId, name: row.tokenName! } : null,
    createdAt: row.createdAt,
  }))
}
