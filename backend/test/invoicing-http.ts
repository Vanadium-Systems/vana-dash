import { and, asc, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { db } from '../src/shared/db/client.js'
import { auditLog, financialRecords, invoiceLineItems } from '../src/shared/db/schema/index.js'
import { trackAudit, trackRecord } from './invoicing-fixtures.js'

// Route-level helpers of the invoice tests: every call goes through app.inject with a session cookie.

export interface DraftLine {
  description: string
  quantity: number
  unitPrice: number
  vatRate?: number
}

export const defaultLines: DraftLine[] = [{ description: 'Abonament QA', quantity: 2, unitPrice: 100, vatRate: 19 }]

export function makeApi(app: FastifyInstance, sessionJwt: string) {
  return async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => {
    const res = await app.inject({ method, url, payload: payload as object | undefined, headers: { cookie: `vana_session=${sessionJwt}` } })
    return { status: res.statusCode, body: res.json() as { success: boolean; data?: any; error?: any } }
  }
}
export type Api = ReturnType<typeof makeApi>

// EUR on purpose: the document HTML asks BNR for an EUR rate on every other currency.
export async function createDraft(api: Api, billingClientId: string, lines: DraftLine[] = defaultLines, extra: Record<string, unknown> = {}) {
  const res = await api('POST', '/api/invoicing/invoices', { billingClientId, currency: 'EUR', lines, ...extra })
  if (res.status !== 201) throw new Error(`draft create failed: ${JSON.stringify(res.body)}`)
  trackRecord(res.body.data.id)
  return res.body.data as { id: string; amount: string; updatedAt: string; documentNumber: string | null; [key: string]: any }
}

export async function createIssued(api: Api, billingClientId: string, lines: DraftLine[] = defaultLines) {
  const draft = await createDraft(api, billingClientId, lines)
  const res = await api('POST', `/api/invoicing/invoices/${draft.id}/issue`)
  if (res.status !== 200) throw new Error(`issue failed: ${JSON.stringify(res.body)}`)
  return res.body.data as { id: string; amount: string; documentNumber: string; [key: string]: any }
}

export async function lineRowsOf(recordId: string) {
  return db
    .select()
    .from(invoiceLineItems)
    .where(and(eq(invoiceLineItems.invoiceId, recordId), isNull(invoiceLineItems.deletedAt)))
    .orderBy(asc(invoiceLineItems.position))
}

export async function recordRow(id: string) {
  const [row] = await db.select().from(financialRecords).where(eq(financialRecords.id, id))
  return row
}

export async function auditActions(entityId: string) {
  trackAudit(entityId)
  const rows = await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.entityId, entityId)).orderBy(asc(auditLog.createdAt))
  return rows.map((row) => row.action)
}
