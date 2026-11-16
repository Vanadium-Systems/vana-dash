/**
 * Part K, BE-K4: every path that reads a client's or a counterparty's IBAN, with the IBAN stored
 * encrypted (iban_enc + iban_hmac). The pre-v1 rows (plaintext only) are covered by the matching
 * tests in invoicing.integration.test.ts, which insert plaintext IBANs directly.
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildServer } from '../src/app.js'
import * as invoicingService from '../src/modules/invoicing/service.js'
import { db } from '../src/shared/db/client.js'
import { billingClients, paymentMatches } from '../src/shared/db/schema/index.js'
import { isV1 } from '../src/shared/lib/crypto.js'
import { protectIban } from '../src/shared/lib/iban.js'
import { cleanup, makeBankTxn, makeIssued, makeUser, RUN, trackAudit } from './invoicing-fixtures.js'
import { makeApi, type Api } from './invoicing-http.js'

vi.mock('../src/shared/lib/pdf.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/shared/lib/pdf.js')>()),
  htmlToPdf: vi.fn(async () => Buffer.from('pdf')),
  isPdfAvailable: () => false,
}))
vi.mock('../src/modules/reconciliation/vanagreen-extension.js', () => ({
  maybeExtendSubscription: vi.fn().mockResolvedValue(undefined),
  pushLegalDetailsIfMapped: vi.fn().mockResolvedValue(undefined),
  pushBillingCycleIfMapped: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../src/shared/lib/payment-confirmation.js', () => ({ sendPaymentConfirmationEmail: vi.fn().mockResolvedValue(undefined) }))

const { autoMatchTransactions } = await import('../src/shared/lib/bank-sync.js')

const IBAN = 'RO49 AAAA 1B31 0075 9384 0042'
let app: Awaited<ReturnType<typeof buildServer>>
let api: Api
const apiClientIds: string[] = []

beforeAll(async () => {
  app = await buildServer()
  const admin = await makeUser(app, [], 'admin')
  api = makeApi(app, admin.cookie)
})

afterAll(async () => {
  await cleanup()
  if (apiClientIds.length) await db.delete(billingClients).where(inArray(billingClients.id, apiClientIds))
  await app.close()
})

async function createClientOverApi(): Promise<{ id: string; iban: string | null }> {
  const res = await api('POST', '/api/invoicing/clients', {
    name: `QA IBAN ${RUN} ${apiClientIds.length + 1}`,
    cif: 'RO4444444',
    address: 'Str. Test 1',
    city: 'Brasov',
    county: 'Brasov',
    iban: IBAN,
  })
  expect(res.status).toBe(201)
  apiClientIds.push(res.body.data.id)
  trackAudit(res.body.data.id)
  return res.body.data
}

describe('client IBAN at rest', () => {
  it('is stored encrypted with an HMAC, and the API still answers with the plain IBAN only', async () => {
    const created = await createClientOverApi()
    expect(created.iban).toBe(IBAN)
    expect(created).not.toHaveProperty('ibanEnc')
    expect(created).not.toHaveProperty('ibanHmac')

    const [row] = await db.select().from(billingClients).where(eq(billingClients.id, created.id))
    expect(row!.iban).toBeNull()
    expect(isV1(row!.ibanEnc!)).toBe(true)
    expect(row!.ibanHmac).toBeTruthy()

    const list = await api('GET', '/api/invoicing/clients')
    const listed = (list.body.data as Array<Record<string, unknown>>).find((c) => c.id === created.id)!
    expect(listed.iban).toBe(IBAN)
    expect(JSON.stringify(list.body)).not.toContain(row!.ibanEnc!)
    expect(listed).not.toHaveProperty('ibanHmac')

    // The assistant tools call the same service functions.
    expect((await invoicingService.getClient(created.id))!.iban).toBe(IBAN)
  })

  it('reaches the invoice document (preview HTML)', async () => {
    const created = await createClientOverApi()
    const res = await api('POST', '/api/invoicing/invoices/preview', {
      billingClientId: created.id,
      currency: 'EUR',
      lines: [{ description: 'IBAN QA', quantity: 1, unitPrice: 42, vatRate: 19 }],
    })
    expect(res.status).toBe(200)
    expect(res.body.data.html).toContain(IBAN)
  })

  it('an update without iban keeps it, an empty iban clears all three columns', async () => {
    const created = await createClientOverApi()
    await api('PATCH', `/api/invoicing/clients/${created.id}`, { city: 'Cluj' })
    expect((await invoicingService.getClient(created.id))!.iban).toBe(IBAN)

    await api('PATCH', `/api/invoicing/clients/${created.id}`, { iban: '' })
    const [row] = await db.select().from(billingClients).where(eq(billingClients.id, created.id))
    expect([row!.iban, row!.ibanEnc, row!.ibanHmac]).toEqual([null, null, null])
  })
})

describe('counterparty IBAN at rest', () => {
  it('automatic matching pairs an encrypted counterparty IBAN with the encrypted client IBAN', async () => {
    const created = await createClientOverApi()
    const invoice = await makeIssued({ amount: '2718.28', billingClientId: created.id, counterpartyName: 'Altcineva' })
    // What bank-sync.ts writes for a transaction from the bank, spaced and lower case on purpose.
    const protectedIban = await protectIban(IBAN.toLowerCase())
    const txn = await makeBankTxn('2718.28', {
      reference: 'fara numar',
      counterpartyIbanEnc: protectedIban.enc,
      counterpartyIbanHmac: protectedIban.hmac,
    })

    await autoMatchTransactions()

    const [match] = await db.select().from(paymentMatches).where(eq(paymentMatches.bankTransactionId, txn.id))
    expect(match?.financialRecordId).toBe(invoice.id)
  })

  it('the transactions list shows the decrypted IBAN and no ciphertext', async () => {
    const protectedIban = await protectIban(IBAN)
    const txn = await makeBankTxn('11.11', { counterpartyIbanEnc: protectedIban.enc, counterpartyIbanHmac: protectedIban.hmac })
    const legacy = await makeBankTxn('11.12', { counterpartyIban: 'RO49AAAA1B31007593840099' })

    const res = await api('GET', '/api/reconciliation/transactions?limit=200')
    expect(res.status).toBe(200)
    const rows = res.body.data as Array<Record<string, unknown>>
    expect(rows.find((r) => r.id === txn.id)!.counterpartyIban).toBe(IBAN)
    expect(rows.find((r) => r.id === legacy.id)!.counterpartyIban).toBe('RO49AAAA1B31007593840099')
    expect(JSON.stringify(res.body)).not.toContain(protectedIban.enc!)
  })
})
