import { db } from '../db/client.js'
import { auditLog } from '../db/schema/index.js'
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
}

export async function recordAudit(entry: AuditEntry) {
  const actor = currentActor()
  await db.insert(auditLog).values({
    actorUserId: entry.actorUserId !== undefined ? entry.actorUserId : actor.userId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    changes: redact(entry.changes) ?? null,
    ip: actor.ip,
  })
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
