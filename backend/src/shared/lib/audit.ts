import { and, asc, eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { auditLog, users } from '../db/schema/index.js'
import { currentActor } from './request-context.js'

// „Cine a făcut ce" (PLAN.md C2). Un singur helper, chemat din service în aceeași tranzacție
// cu schimbarea. Actorul vine din contextul requestului (request-context.ts), deci un service
// nou nu poate „uita" să îl declare — și un job ajunge aici cu actor null, adică sistem.
//
// Diff-ul exclude secretele: o cheie, un token sau un hash de parolă n-are ce căuta într-un
// istoric pe care orice om din echipă îl poate citi.

const SECRET_FIELDS = /(key|secret|token|password|hash|authorization|cookie)/i
const REDACTED = '[redactat]'

function redact(changes: Record<string, [unknown, unknown]> | undefined) {
  if (!changes) return undefined
  const out: Record<string, [unknown, unknown]> = {}
  for (const [field, pair] of Object.entries(changes)) {
    out[field] = SECRET_FIELDS.test(field) ? [REDACTED, REDACTED] : pair
  }
  return out
}

export interface AuditEntry {
  action: string
  entityType: string
  entityId?: string | null
  changes?: Record<string, [unknown, unknown]>
  /** Explicit doar unde contextul nu e requestul (importuri, scripturi de migrare). */
  actorUserId?: string | null
  /** The open transaction, when the audit row must commit or roll back with the change. */
  executor?: Pick<typeof db, 'insert'>
}

export async function recordAudit(entry: AuditEntry) {
  const actor = currentActor()
  await (entry.executor ?? db).insert(auditLog).values({
    actorUserId: entry.actorUserId !== undefined ? entry.actorUserId : actor.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    changes: redact(entry.changes) ?? null,
    ip: actor.ip,
  })
}

export interface EntityHistoryItem {
  id: string
  at: Date
  action: string
  actor: { id: string; name: string | null } | null
  changes: Record<string, [unknown, unknown]> | null
}

/**
 * The audit rows of one object, oldest first, for a history panel. An object can be logged under
 * more than one `entityType` (an issued invoice is `invoice`, a received one `financial_record`),
 * so the types are a list; the id alone is unique anyway.
 */
export async function listEntityHistory(entityTypes: string[], entityId: string, limit = 200): Promise<EntityHistoryItem[]> {
  const rows = await db
    .select({
      id: auditLog.id,
      at: auditLog.createdAt,
      action: auditLog.action,
      changes: auditLog.changes,
      actorId: users.id,
      actorName: users.displayName,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(and(inArray(auditLog.entityType, entityTypes), eq(auditLog.entityId, entityId)))
    .orderBy(asc(auditLog.createdAt))
    .limit(limit)
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    action: row.action,
    actor: row.actorId ? { id: row.actorId, name: row.actorName } : null,
    changes: row.changes ?? null,
  }))
}

// ── Coloanele de autor (created_by / updated_by) ────────────────────────────────────────────

/**
 * Completează coloanele de autor dintr-o valoare scrisă într-un tabel care le are, folosind
 * omul din contextul requestului. În joburi și scripturi store-ul e gol → nu adaugă nimic, deci
 * rândul rămâne cu autor null („acțiune de sistem”), exact cum cere C2.
 *
 * Se apelează explicit în service-uri, nu printr-un wrapper Drizzle: un Proxy peste `db`
 * ar face implicită o scriere pe calea cea mai fierbinte a aplicației, iar greșeala s-ar
 * manifesta ca „coloană inexistentă" la scriere, departe de locul greșelii.
 */
export function updatedByUserId(): Record<string, string> {
  const userId = currentActor().userId
  return userId ? { updatedByUserId: userId } : {}
}

export function createdByUserId(): Record<string, string> {
  const userId = currentActor().userId
  return userId ? { createdByUserId: userId } : {}
}
