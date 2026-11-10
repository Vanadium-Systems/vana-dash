import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { billingClients, contractAddenda, contractDocuments } from '../../shared/db/schema/index.js'
import { listContracts } from './service.js'

const clientIds: string[] = []
const tag = `ListQA${Date.now()}`

async function makeClient(suffix: string, nrContract?: string) {
  const [row] = await db
    .insert(billingClients)
    .values({ name: `${tag} ${suffix}`, cif: 'RO99999997', address: 'Str. Test 2', contractDetails: nrContract ? { nrContract, dataContract: '2026-01-05' } : null })
    .returning()
  clientIds.push(row!.id)
  return row!
}

afterAll(async () => {
  if (!clientIds.length) return
  await db.delete(contractAddenda).where(inArray(contractAddenda.billingClientId, clientIds))
  await db.delete(contractDocuments).where(inArray(contractDocuments.billingClientId, clientIds))
  await db.delete(billingClients).where(inArray(billingClients.id, clientIds))
})

describe('listContracts', async () => {
  const none = await makeClient('a none')
  const generated = await makeClient('b generated', '101')
  const signed = await makeClient('c signed', '102')
  const addendum = await makeClient('d addendum', '103')
  await db.insert(contractDocuments).values({ billingClientId: generated.id, docType: 'contract', pdfStoragePath: 'g.pdf' })
  await db.insert(contractDocuments).values({ billingClientId: signed.id, docType: 'contract', pdfStoragePath: 's.pdf', isSigned: true })
  await db.insert(contractDocuments).values({ billingClientId: addendum.id, docType: 'contract', pdfStoragePath: 'd.pdf', isSigned: true })
  await db.insert(contractAddenda).values({
    billingClientId: addendum.id,
    number: 1,
    issuedAt: '2026-02-01',
    oldPriceNote: 'a',
    newPriceNote: 'b',
    reason: 'r',
    effectiveDateNote: 'e',
  })
  const query = { q: tag, page: 1, pageSize: 25 as const }

  it('derives the state per client', async () => {
    const { rows, total } = await listContracts(query)
    expect(total).toBe(4)
    expect(rows.map((r) => [r.clientId, r.state])).toEqual([
      [none.id, 'none'],
      [generated.id, 'generated'],
      [signed.id, 'signed'],
      [addendum.id, 'addendum'],
    ])
    expect(rows[0]!.lastDocument).toBeNull()
    expect(rows[2]!.lastDocument?.kind).toBe('contract')
    expect(rows[2]!.contractNumber).toBe('102')
  })

  it('filters by state and searches by contract number', async () => {
    expect((await listContracts({ ...query, state: 'signed' })).rows.map((r) => r.clientId)).toEqual([signed.id])
    expect((await listContracts({ ...query, q: '103' })).rows.map((r) => r.clientId)).toEqual([addendum.id])
  })

  it('treats LIKE wildcards in the search as plain text', async () => {
    expect((await listContracts({ ...query, q: `${tag}%` })).total).toBe(0)
  })

  it('paginates', async () => {
    const second = await listContracts({ ...query, pageSize: 10, page: 1 })
    expect(second.rows).toHaveLength(4)
    const empty = await listContracts({ ...query, pageSize: 10, page: 2 })
    expect(empty.rows).toHaveLength(0)
  })
})
