import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { financialRecords } from '../../shared/db/schema/index.js'
import { listDeadlines } from './deadlines.js'

const ids: string[] = []
const day = 24 * 60 * 60 * 1000

async function invoice(documentNumber: string, dueInDays: number, paymentStatus: 'unpaid' | 'paid') {
  const [row] = await db
    .insert(financialRecords)
    .values({
      type: 'invoice',
      direction: 'out',
      amount: '100.00',
      issuedAt: new Date(),
      dueAt: new Date(Date.now() + dueInDays * day),
      paymentStatus,
      source: 'generated',
      documentNumber,
      counterpartyName: 'Acme',
    })
    .returning({ id: financialRecords.id })
  ids.push(row!.id)
  return row!.id
}

afterAll(async () => {
  if (ids.length) await db.delete(financialRecords).where(inArray(financialRecords.id, ids))
})

describe('listDeadlines', () => {
  it('an unpaid overdue invoice is listed as overdue, a paid one is not', async () => {
    const lateId = await invoice('QA-DL-1', -5, 'unpaid')
    const paidId = await invoice('QA-DL-2', -5, 'paid')
    const items = await listDeadlines(['facturi.view'])
    const late = items.find((i) => i.ref?.id === lateId)
    expect(late).toMatchObject({ kind: 'invoice_due', overdue: true, title: 'QA-DL-1 · Acme' })
    expect(items.some((i) => i.ref?.id === paidId)).toBe(false)
  })

  it('declaration rows only reach people with facturi.declaratii', async () => {
    const without = await listDeadlines(['facturi.view'])
    expect(without.some((i) => i.kind === 'declaration')).toBe(false)
    const withIt = await listDeadlines(['facturi.view', 'facturi.declaratii'])
    expect(withIt.some((i) => i.kind === 'declaration')).toBe(true)
  })
})
