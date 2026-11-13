/**
 * Sprint 7, Wave 6: storno (full and partial) and proforma over HTTP, and the guarantee that a
 * proforma is counted by none of the consumers that count invoices.
 * Integration test, pg real (test/setup.ts).
 */
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildServer } from '../src/app.js'
import { generateD301Preview, generateD390Preview } from '../src/modules/accounting/d301.js'
import { getQuarterlyPackageSummary } from '../src/modules/accounting/quarterly-package.js'
import { db } from '../src/shared/db/client.js'
import { paymentMatches } from '../src/shared/db/schema/index.js'
import { getCompany } from '../src/shared/lib/company.js'
import {
  getCashflowByStatus,
  getDailyPaidRevenue,
  getPnlByCategory,
  getPnlByMonth,
  getPnlTotals,
} from '../src/shared/lib/financial-aggregation.js'
import {
  cleanup,
  currentSequenceValue,
  makeBankTxn,
  makeClient,
  makeIssued,
  makeRecord,
  makeUser,
  RUN,
  trackRecord,
  uniqueNumber,
  useTestSequence,
} from './invoicing-fixtures.js'
import { auditActions, createDraft, createIssued, lineRowsOf, makeApi, recordRow, type Api } from './invoicing-http.js'

vi.mock('../src/shared/lib/pdf.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/shared/lib/pdf.js')>()),
  htmlToPdf: vi.fn(async () => Buffer.from('pdf')),
  isPdfAvailable: () => false,
}))
vi.mock('../src/modules/reconciliation/vanagreen-extension.js', () => ({
  maybeExtendSubscription: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../src/shared/lib/payment-confirmation.js', () => ({ sendPaymentConfirmationEmail: vi.fn().mockResolvedValue(undefined) }))

const { autoMatchTransactions } = await import('../src/shared/lib/bank-sync.js')

let app: Awaited<ReturnType<typeof buildServer>>
let api: Api

beforeAll(async () => {
  app = await buildServer()
  const admin = await makeUser(app, [], 'admin')
  api = makeApi(app, admin.cookie)
  await useTestSequence('invoice', `T${RUN}`)
  await useTestSequence('proforma', 'PRO')
})

afterAll(async () => {
  await cleanup()
  await app.close()
})

const stornoLines = [
  { description: 'Linia 1', quantity: 4, unitPrice: 25, vatRate: 0 },
  { description: 'Linia 2', quantity: 1, unitPrice: 50, vatRate: 0 },
]

const detailOf = async (id: string) => (await api('GET', `/api/accounting/records/${id}/detail`)).body.data

describe('storno', () => {
  it('partial then full: negative quantities, positive prices, capped per line, the original owes less once issued', async () => {
    const client = await makeClient()
    const original = await createIssued(api, client.id, stornoLines)
    const [line1] = await lineRowsOf(original.id)
    expect(original.amount).toBe('150.00')

    // Partial: 1 of the 4 units on line 1.
    const partial = await api('POST', `/api/invoicing/invoices/${original.id}/storno`, { mode: 'partial', lines: [{ lineId: line1!.id, quantity: 1 }] })
    expect(partial.status).toBe(201)
    const partialDraft = partial.body.data
    trackRecord(partialDraft.id)
    expect(partialDraft).toMatchObject({ type: 'invoice', correctsRecordId: original.id, documentNumber: null, amount: '-25.00' })
    expect((await lineRowsOf(partialDraft.id)).map((l) => [Number(l.quantity), Number(l.unitPrice)])).toEqual([[-1, 25]])

    // The draft reserves its unit: 3 are left on line 1, so 4 is too much.
    const tooMuch = await api('POST', `/api/invoicing/invoices/${original.id}/storno`, { mode: 'partial', lines: [{ lineId: line1!.id, quantity: 4 }] })
    expect(tooMuch.status).toBe(400)
    expect(tooMuch.body.error.code).toBe('STORNO_EXCEEDS')

    // Nothing owed less until the storno is numbered.
    expect((await detailOf(original.id)).remaining).toBe(150)
    const issuedPartial = await api('POST', `/api/invoicing/invoices/${partialDraft.id}/issue`)
    expect(issuedPartial.status).toBe(200)
    expect(issuedPartial.body.data.documentNumber).toMatch(new RegExp(`^T${RUN}-`))
    expect((await detailOf(original.id)).remaining).toBe(125)

    // Full: what is left, 3 and 1.
    const full = await api('POST', `/api/invoicing/invoices/${original.id}/storno`, { mode: 'full' })
    expect(full.status).toBe(201)
    trackRecord(full.body.data.id)
    expect(full.body.data).toMatchObject({ correctsRecordId: original.id, amount: '-125.00' })
    expect((await lineRowsOf(full.body.data.id)).map((l) => [l.description, Number(l.quantity), Number(l.unitPrice)])).toEqual([
      ['Linia 1', -3, 25],
      ['Linia 2', -1, 50],
    ])

    expect((await api('POST', `/api/invoicing/invoices/${full.body.data.id}/issue`)).status).toBe(200)
    const after = await detailOf(original.id)
    expect(after.remaining).toBe(0)
    expect(after.storno.correctedBy).toHaveLength(2)
    expect(await auditActions(original.id)).toContain('factura.storno.emisa')

    // Nothing left to reverse.
    const again = await api('POST', `/api/invoicing/invoices/${original.id}/storno`, { mode: 'full' })
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('NOTHING_TO_STORNO')
  })

  it('a draft invoice cannot be reversed', async () => {
    const client = await makeClient()
    const draft = await createDraft(api, client.id)
    const res = await api('POST', `/api/invoicing/invoices/${draft.id}/storno`, { mode: 'full' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('NOT_STORNABLE')
  })

  it('a storno cannot be duplicated', async () => {
    const client = await makeClient()
    const original = await createIssued(api, client.id)
    const storno = await api('POST', `/api/invoicing/invoices/${original.id}/storno`, { mode: 'full' })
    trackRecord(storno.body.data.id)
    expect((await api('POST', `/api/invoicing/invoices/${storno.body.data.id}/duplicate`)).status).toBe(409)
  })
})

describe('proforma', () => {
  const proformaLines = [
    { description: 'Servicii QA', quantity: 2, unitPrice: 100, vatRate: 19 },
    { description: 'Instalare QA', quantity: 1, unitPrice: 30, vatRate: 0 },
  ]
  const createProforma = async (clientId: string) => {
    const res = await api('POST', '/api/invoicing/proformas', { billingClientId: clientId, currency: 'EUR', lines: proformaLines })
    expect(res.status).toBe(201)
    trackRecord(res.body.data.id)
    return res.body.data as { id: string; [key: string]: any }
  }

  it('draft, issue from its own series with no XML or ANAF state, convert, invoiced once the invoice is issued', async () => {
    const client = await makeClient()
    const invoiceSequenceBefore = await currentSequenceValue('invoice')

    const draft = await createProforma(client.id)
    expect(draft).toMatchObject({ type: 'proforma', documentNumber: null, proformaStatus: 'open', anafStatus: null })

    const issued = await api('POST', `/api/invoicing/proformas/${draft.id}/issue`)
    expect(issued.status).toBe(200)
    expect(issued.body.data.documentNumber).toMatch(/^PRO-/)
    expect(await currentSequenceValue('invoice')).toBe(invoiceSequenceBefore)
    const row = await recordRow(draft.id)
    expect(row).toMatchObject({ xmlStoragePath: null, anafStatus: null, proformaStatus: 'open' })

    const converted = await api('POST', `/api/invoicing/proformas/${draft.id}/convert`)
    expect(converted.status).toBe(201)
    const invoiceDraft = converted.body.data
    trackRecord(invoiceDraft.id)
    expect(invoiceDraft).toMatchObject({ type: 'invoice', documentNumber: null, amount: issued.body.data.amount, currency: 'EUR' })
    expect((await lineRowsOf(invoiceDraft.id)).map((l) => [l.description, Number(l.quantity), Number(l.unitPrice), Number(l.vatRate)])).toEqual(
      proformaLines.map((l) => [l.description, l.quantity, l.unitPrice, l.vatRate]),
    )
    // Linked, but the proforma is invoiced only when the invoice gets its number.
    expect((await recordRow(draft.id))).toMatchObject({ convertedToRecordId: invoiceDraft.id, proformaStatus: 'open' })
    expect((await api('POST', `/api/invoicing/proformas/${draft.id}/convert`)).body.error.code).toBe('PROFORMA_ALREADY_CONVERTED')

    expect((await api('POST', `/api/invoicing/invoices/${invoiceDraft.id}/issue`)).status).toBe(200)
    expect((await recordRow(draft.id))!.proformaStatus).toBe('invoiced')
    expect(await currentSequenceValue('invoice')).toBe(invoiceSequenceBefore + 1)

    const detail = await detailOf(draft.id)
    expect(detail.proforma.status).toBe('invoiced')
    expect(detail.proforma.convertedTo.id).toBe(invoiceDraft.id)
    expect(await auditActions(draft.id)).toEqual(expect.arrayContaining(['proforma.ciorna.creata', 'proforma.emisa', 'proforma.convertita', 'proforma.facturata']))

    const cancel = await api('POST', `/api/invoicing/proformas/${draft.id}/cancel`)
    expect(cancel.status).toBe(409)
    expect(cancel.body.error.code).toBe('PROFORMA_INVOICED')
  })

  it('cancel: an issued proforma becomes cancelled and can no longer be converted; a draft cannot be converted', async () => {
    const client = await makeClient()
    const notIssued = await createProforma(client.id)
    const early = await api('POST', `/api/invoicing/proformas/${notIssued.id}/convert`)
    expect(early.status).toBe(409)
    expect(early.body.error.code).toBe('PROFORMA_NOT_ISSUED')

    const proforma = await createProforma(client.id)
    expect((await api('POST', `/api/invoicing/proformas/${proforma.id}/issue`)).status).toBe(200)
    const cancelled = await api('POST', `/api/invoicing/proformas/${proforma.id}/cancel`)
    expect(cancelled.status).toBe(200)
    expect(cancelled.body.data.proformaStatus).toBe('cancelled')
    expect((await api('POST', `/api/invoicing/proformas/${proforma.id}/convert`)).body.error.code).toBe('PROFORMA_CANCELLED')
    expect(await auditActions(proforma.id)).toContain('proforma.anulata')
  })

  it('a proforma cannot be paid through the invoice routes', async () => {
    const client = await makeClient()
    const proforma = await createProforma(client.id)
    await api('POST', `/api/invoicing/proformas/${proforma.id}/issue`)
    const res = await api('POST', `/api/invoicing/invoices/${proforma.id}/payments`, { amount: 10, paidAt: new Date().toISOString().slice(0, 10), method: 'cash' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('NOT_PAYABLE')
  })
})

// A proforma is an offer. Each consumer below gets one invoice (the control, proves the query
// sees the period) and one proforma in the same period, marked paid to give it every chance to leak.
describe('proforma is counted nowhere', () => {
  const issuedAt = new Date('2031-05-10T12:00:00Z')
  const range = { from: new Date('2031-05-01T00:00:00Z'), to: new Date('2031-05-31T23:59:59Z') }
  const tag = `PF${RUN} Client`
  let proformaId: string
  let invoiceId: string

  beforeAll(async () => {
    expect((await getCompany()).currency).toBe('RON')
    const invoice = await makeRecord({ type: 'invoice', amount: '100.00', currency: 'RON', issuedAt, paymentStatus: 'paid', counterpartyName: tag })
    const proforma = await makeRecord({
      type: 'proforma',
      amount: '777.00',
      currency: 'RON',
      issuedAt,
      paymentStatus: 'paid',
      anafStatus: null,
      proformaStatus: 'open',
      documentNumber: uniqueNumber('PRO'),
      counterpartyName: tag,
    })
    invoiceId = invoice.id
    proformaId = proforma.id
  })

  const sum = (rows: Array<{ total: number; direction: string }>) => rows.filter((r) => r.direction === 'out').reduce((acc, r) => acc + r.total, 0)

  it('P&L: totals, by month, by category', async () => {
    expect((await getPnlTotals(range)).revenue).toBe(100)
    expect(sum(await getPnlByMonth(range))).toBe(100)
    expect(sum(await getPnlByCategory(range))).toBe(100)
  })

  it('cashflow and daily paid revenue', async () => {
    const cashflow = await getCashflowByStatus(range)
    expect(cashflow.filter((r) => r.direction === 'out').map((r) => [r.paymentStatus, r.total, r.count])).toEqual([['paid', 100, 1]])
    expect((await getDailyPaidRevenue(range)).map((r) => r.value)).toEqual([100])
  })

  it('quarterly package: revenue and invoices issued', async () => {
    const summary = await getQuarterlyPackageSummary('2031-Q2')
    expect(summary.revenueRon).toBe(100)
    expect(summary.invoicesIssued).toBe(1)
  })

  it('D301 and D390 lines', async () => {
    // Reverse charge applies to received documents; the proforma carries the flag to prove the filter is not left to direction alone.
    const control = await makeRecord({
      type: 'expense',
      direction: 'in',
      amount: '100.00',
      currency: 'RON',
      issuedAt,
      reverseChargeType: 'non_eu_services',
      counterpartyName: tag,
    })
    const flagged = await makeRecord({
      type: 'proforma',
      amount: '50.00',
      currency: 'RON',
      issuedAt,
      anafStatus: null,
      proformaStatus: 'open',
      documentNumber: uniqueNumber('PRO'),
      reverseChargeType: 'eu_services',
    })
    const d301 = await generateD301Preview('2031-05')
    expect(d301.lines.map((l) => l.recordId)).toContain(control.id)
    expect(d301.lines.map((l) => l.recordId)).not.toContain(flagged.id)
    const d390 = await generateD390Preview('2031-05')
    expect(d390.lines.map((l) => l.recordId)).not.toContain(flagged.id)
  })

  it('records list: not in items, counts or totals', async () => {
    const res = await api('GET', `/api/accounting/records?q=PF${RUN}&direction=out&tab=all`)
    const data = res.body.data
    expect(data.items.map((i: { id: string }) => i.id)).toEqual([invoiceId])
    expect(data.counts.all).toBe(1)
    expect(data.totals).toEqual({ total: 100, paid: 100, open: 0, overdue: 0 })
    expect(data.items.map((i: { id: string }) => i.id)).not.toContain(proformaId)
  })

  it('reconciliation: not an open invoice, never auto-matched', async () => {
    const iban = 'RO49AAAA1B31007593840002'
    const client = await makeClient({ iban })
    const number = uniqueNumber('PRO')
    const offer = await makeIssued({
      type: 'proforma',
      amount: '888.88',
      issuedAt: new Date(),
      anafStatus: null,
      proformaStatus: 'open',
      documentNumber: number,
      billingClientId: client.id,
      counterpartyName: client.name,
    })
    const txn = await makeBankTxn('888.88', { counterpartyIban: iban, reference: `plata ${number}` })

    const open = await api('GET', '/api/reconciliation/open-invoices')
    expect((open.body.data as Array<{ id: string }>).map((r) => r.id)).not.toContain(offer.id)

    await autoMatchTransactions()
    expect(await db.select().from(paymentMatches).where(eq(paymentMatches.bankTransactionId, txn.id))).toHaveLength(0)
    expect((await recordRow(offer.id))!.paymentStatus).toBe('unpaid')
  })
})
