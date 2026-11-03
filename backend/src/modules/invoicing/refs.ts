import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { financialRecords } from '../../shared/db/schema/index.js'
import { registerRefType, type RefSnapshot } from '../../shared/lib/entity-refs.js'
import type { SessionUser } from '../../shared/lib/session.js'

const canSee = (me: SessionUser) => me.features.includes('facturi.view')

async function cards(ids: string[]): Promise<Map<string, RefSnapshot>> {
  const rows = await db
    .select({
      id: financialRecords.id,
      documentNumber: financialRecords.documentNumber,
      counterpartyName: financialRecords.counterpartyName,
      amount: financialRecords.amount,
      currency: financialRecords.currency,
      paymentStatus: financialRecords.paymentStatus,
      direction: financialRecords.direction,
    })
    .from(financialRecords)
    .where(and(inArray(financialRecords.id, ids), eq(financialRecords.type, 'invoice'), isNull(financialRecords.deletedAt)))
  return new Map(
    rows.map((r) => [
      r.id,
      {
        title: r.documentNumber ?? r.counterpartyName ?? '',
        clientName: r.counterpartyName,
        total: r.amount,
        currency: r.currency,
        status: r.paymentStatus,
        direction: r.direction,
      },
    ]),
  )
}

registerRefType('invoice', {
  kind: 'firm',
  async snapshot(refId, sender) {
    if (!canSee(sender)) return null
    const card = (await cards([refId])).get(refId)
    return card ? { card } : null
  },
  async resolve(refIds, reader) {
    const live = await cards(refIds)
    return new Map(refIds.map((id) => [id, { canOpen: canSee(reader) && live.has(id), live: live.get(id), gone: !live.has(id) }]))
  },
})
