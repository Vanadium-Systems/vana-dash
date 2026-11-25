import { readFile } from 'node:fs/promises'
import { inArray, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { billingClients, contractDocuments, contracts, users } from '../../shared/db/schema/index.js'
import { listRegistry } from './registry-service.js'

const clientIds: string[] = []
const scratchContractIds: string[] = []
const tag = `ListQA${Date.now()}`

async function makeClient(suffix: string, values: Partial<typeof billingClients.$inferInsert> = {}) {
  const [row] = await db
    .insert(billingClients)
    .values({ name: `${tag} ${suffix}`, cif: 'RO99999997', address: 'Str. Test 2', ...values })
    .returning()
  clientIds.push(row!.id)
  return row!
}

// A document needs a contract; a scratch one stands in for the contract the backfill has not made yet.
async function addDocument(clientId: string, signed: boolean) {
  const [owner] = await db.select({ id: users.id }).from(users).limit(1)
  const [scratch] = await db
    .insert(contracts)
    .values({ title: 'scratch', category: 'other', counterpartyKind: 'other', counterpartyName: 'Acme', ownerUserId: owner!.id, status: 'draft', origin: 'uploaded' })
    .returning({ id: contracts.id })
  scratchContractIds.push(scratch!.id)
  await db.insert(contractDocuments).values({ billingClientId: clientId, contractId: scratch!.id, docType: 'contract', pdfStoragePath: 'x.pdf', isSigned: signed })
}

/** The SaaS-contract statement of migration 0111, limited to the clients of this test. */
async function runBackfill(ids: string[]) {
  const migration = await readFile(new URL('../../shared/db/migrations/0111_contracts_registry.sql', import.meta.url), 'utf8')
  const start = migration.indexOf('INSERT INTO "contracts"')
  const statement = migration.slice(start, migration.indexOf('--> statement-breakpoint', start))
  const scoped = statement.replace(' WHERE (EXISTS (SELECT 1 FROM "contract_documents" d WHERE d."billing_client_id" = c."id")', ' WHERE c."id" IN (__IDS__) AND (EXISTS (SELECT 1 FROM "contract_documents" d WHERE d."billing_client_id" = c."id")')
  expect(scoped).not.toBe(statement)
  await db.execute(sql.raw(scoped.replace('__IDS__', ids.map((id) => `'${id}'`).join(', '))))
}

afterAll(async () => {
  if (clientIds.length) {
    await db.delete(contractDocuments).where(inArray(contractDocuments.billingClientId, clientIds))
    await db.delete(contracts).where(inArray(contracts.billingClientId, clientIds))
    await db.delete(billingClients).where(inArray(billingClients.id, clientIds))
  }
  if (scratchContractIds.length) await db.delete(contracts).where(inArray(contracts.id, scratchContractIds))
})

describe('listRegistry', async () => {
  const [admin] = await db.select({ id: users.id }).from(users).limit(1)
  const me = { id: admin!.id, isPlatformAdmin: true, role: null }
  const query = { q: tag, page: 1, pageSize: 25 as const }

  const demo = await makeClient('a demo', { isDemo: true, contractDetails: { nrContract: '901' } })
  const former = await makeClient('b former', { deletedAt: new Date() })
  const active = await makeClient('c active')
  const withNumber = await makeClient('d with number', { contractDetails: { nrContract: '902' } })
  await addDocument(former.id, true)
  await addDocument(active.id, false)
  await runBackfill(clientIds)

  it('backfills only what has a document or a number, and a deleted client as terminated', async () => {
    const { items, total } = await listRegistry(me, query)
    const byName = new Map(items.map((i) => [i.counterpartyName, i]))
    expect(total).toBe(3)
    expect(byName.has(demo.name)).toBe(false)
    expect(byName.get(former.name)).toMatchObject({ status: 'terminated', origin: 'saas' })
    expect(byName.get(active.name)).toMatchObject({ status: 'draft', origin: 'saas' })
    expect(byName.get(withNumber.name)?.externalNumber).toBe('902')
  })

  it('does not list an active client with no document and no contract number', async () => {
    const bare = await makeClient('e bare')
    await runBackfill([bare.id])
    const { items } = await listRegistry(me, query)
    expect(items.map((i) => i.counterpartyName)).not.toContain(bare.name)
  })

  it('treats LIKE wildcards in the search as plain text and paginates', async () => {
    expect((await listRegistry(me, { ...query, q: `${tag}%` })).total).toBe(0)
    expect((await listRegistry(me, { ...query, pageSize: 10, page: 2 })).items).toHaveLength(0)
  })
})
