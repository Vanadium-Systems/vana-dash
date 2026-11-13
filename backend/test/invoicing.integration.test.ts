/**
 * Sprint 7, invoices over HTTP (app.inject): the issue lock, draft conflicts, duplicate, preview,
 * the paged records list, the document page, reconciliation without drafts and the audit trail.
 * Integration test, pg real (test/setup.ts). Payments themselves are in payments.integration.test.ts.
 */
import { count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildServer } from '../src/app.js'
import { companyToday } from '../src/modules/invoicing/service.js'
import { db } from '../src/shared/db/client.js'
import { auditLog, financialRecords, invoicePayments, paymentMatches } from '../src/shared/db/schema/index.js'
import { getCompany } from '../src/shared/lib/company.js'
import { tr } from '../src/shared/lib/i18n.js'
import { htmlToPdf } from '../src/shared/lib/pdf.js'
import { addPayment } from '../src/shared/lib/payments.js'
import {
  cleanup,
  currentSequenceValue,
  makeBankTxn,
  makeClient,
  makeDraftRow,
  makeIssued,
  makeUser,
  RUN,
  trackRecord,
  useTestSequence,
} from './invoicing-fixtures.js'
import { auditActions, createDraft, createIssued, lineRowsOf, makeApi, recordRow, type Api } from './invoicing-http.js'

// No Chromium in the tests: the preview must not reach the PDF renderer at all.
vi.mock('../src/shared/lib/pdf.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/shared/lib/pdf.js')>()),
  htmlToPdf: vi.fn(async () => Buffer.from('pdf')),
  isPdfAvailable: () => false,
}))
const maybeExtendMock = vi.fn().mockResolvedValue(undefined)
vi.mock('../src/modules/reconciliation/vanagreen-extension.js', () => ({
  maybeExtendSubscription: (...args: unknown[]) => maybeExtendMock(...args),
}))
vi.mock('../src/shared/lib/payment-confirmation.js', () => ({ sendPaymentConfirmationEmail: vi.fn().mockResolvedValue(undefined) }))

const { autoMatchTransactions } = await import('../src/shared/lib/bank-sync.js')

let app: Awaited<ReturnType<typeof buildServer>>
let api: Api
const today = new Date().toISOString().slice(0, 10)
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000)
const daysAhead = (days: number) => new Date(Date.now() + days * 24 * 60 * 60 * 1000)

beforeAll(async () => {
  app = await buildServer()
  const admin = await makeUser(app, [], 'admin')
  api = makeApi(app, admin.cookie)
  await useTestSequence('invoice', `T${RUN}`)
})

afterAll(async () => {
  await cleanup()
  await app.close()
})

describe('issue lock', () => {
  it('two simultaneous issues of one draft: one wins, one number, the sequence moves by exactly one', async () => {
    const client = await makeClient()
    const draft = await createDraft(api, client.id)
    const before = await currentSequenceValue('invoice')

    const results = await Promise.all([
      api('POST', `/api/invoicing/invoices/${draft.id}/issue`),
      api('POST', `/api/invoicing/invoices/${draft.id}/issue`),
    ])

    expect(results.map((r) => r.status).sort()).toEqual([200, 400])
    const winner = results.find((r) => r.status === 200)!
    const row = await recordRow(draft.id)
    expect(row!.documentNumber).toBe(winner.body.data.documentNumber)
    expect(row!.documentNumber).toMatch(new RegExp(`^T${RUN}-`))
    expect(await currentSequenceValue('invoice')).toBe(before + 1)
  })
})

describe('draft editing', () => {
  it('PATCH with a stale expectedUpdatedAt answers 409 DRAFT_CHANGED, with the current one 200', async () => {
    const client = await makeClient()
    const draft = await createDraft(api, client.id)

    const first = await api('PATCH', `/api/invoicing/invoices/${draft.id}`, { note: 'prima', expectedUpdatedAt: draft.updatedAt })
    expect(first.status).toBe(200)

    const stale = await api('PATCH', `/api/invoicing/invoices/${draft.id}`, { note: 'veche', expectedUpdatedAt: draft.updatedAt })
    expect(stale.status).toBe(409)
    expect(stale.body.error.code).toBe('DRAFT_CHANGED')
    expect((await recordRow(draft.id))!.description).toBe('prima')

    const current = await api('PATCH', `/api/invoicing/invoices/${draft.id}`, { note: 'a doua', expectedUpdatedAt: first.body.data.updatedAt })
    expect(current.status).toBe(200)
    expect(current.body.data.description).toBe('a doua')
  })
})

describe('duplicate', () => {
  it('an issued invoice becomes a new draft: no number, today, same lines, audited', async () => {
    const client = await makeClient()
    const lines = [
      { description: 'Linia A', quantity: 3, unitPrice: 10, vatRate: 19 },
      { description: 'Linia B', quantity: 1, unitPrice: 55.5, vatRate: 9 },
    ]
    const issued = await createIssued(api, client.id, lines)

    const res = await api('POST', `/api/invoicing/invoices/${issued.id}/duplicate`)
    expect(res.status).toBe(201)
    const copy = res.body.data
    trackRecord(copy.id)
    expect(copy.id).not.toBe(issued.id)
    expect(copy.documentNumber).toBeNull()
    expect(copy.paymentStatus).toBe('unpaid')
    expect(copy.amount).toBe(issued.amount)
    expect(new Date(copy.issuedAt).toISOString()).toBe((await companyToday()).toISOString())

    const copied = await lineRowsOf(copy.id)
    expect(copied.map((l) => [l.description, Number(l.quantity), Number(l.unitPrice), Number(l.vatRate)])).toEqual([
      ['Linia A', 3, 10, 19],
      ['Linia B', 1, 55.5, 9],
    ])
    expect(await auditActions(copy.id)).toContain('factura.duplicata')
  })
})

describe('preview', () => {
  it('returns the draft HTML, writes nothing and never reaches the PDF renderer', async () => {
    const client = await makeClient()
    vi.mocked(htmlToPdf).mockClear()
    const records = () => db.select({ n: count() }).from(financialRecords).then(([r]) => r!.n)
    const audits = () => db.select({ n: count() }).from(auditLog).where(eq(auditLog.entityType, 'invoice')).then(([r]) => r!.n)
    const [recordsBefore, auditsBefore] = [await records(), await audits()]

    const res = await api('POST', '/api/invoicing/invoices/preview', {
      billingClientId: client.id,
      currency: 'EUR',
      lines: [{ description: 'Previzualizare QA', quantity: 1, unitPrice: 42, vatRate: 19 }],
    })

    expect(res.status).toBe(200)
    expect(res.body.data.html).toContain('Previzualizare QA')
    expect(res.body.data.html).toContain(tr('errors.invoicing.draftBanner'))
    expect(await records()).toBe(recordsBefore)
    expect(await audits()).toBe(auditsBefore)
    expect(htmlToPdf).not.toHaveBeenCalled()
  })
})

describe('records list', () => {
  it('counts per tab, totals that ignore the tab, pagination, drafts never open', async () => {
    const { currency } = await getCompany()
    const name = `LIST${RUN} Client`
    const base = { counterpartyName: name, currency }
    const draft = await makeDraftRow({ ...base, amount: '50.00' })
    const partial = await makeIssued({ ...base, amount: '200.00', dueAt: daysAhead(20) })
    await addPayment(partial.id, { amount: 80, paidAt: today, method: 'cash' })
    const paid = await makeIssued({ ...base, amount: '100.00', dueAt: daysAhead(20) })
    await addPayment(paid.id, { amount: 100, paidAt: today, method: 'cash' })
    const overdue = await makeIssued({ ...base, amount: '300.00', dueAt: daysAgo(10) })
    const rejected = await makeIssued({ ...base, amount: '70.00', anafStatus: 'rejected' })

    const list = async (query: string) => {
      const res = await api('GET', `/api/accounting/records?q=LIST${RUN}&direction=out&${query}`)
      expect(res.status).toBe(200)
      return res.body.data as { items: Array<{ id: string; remaining: number; isOverdue: boolean; documentNumber: string | null }>; total: number; totals: Record<string, number>; counts: Record<string, number> }
    }

    const all = await list('tab=all')
    expect(all.counts).toMatchObject({ all: 5, draft: 1, open: 2, overdue: 1, paid: 1, rejected: 1 })
    // Drafts and rejected invoices are not money: total = paid + open.
    expect(all.totals).toEqual({ total: 600, paid: 180, open: 420, overdue: 300 })
    expect(all.total).toBe(5)

    const open = await list('tab=open')
    expect(open.items.map((i) => i.id).sort()).toEqual([partial.id, overdue.id].sort())
    expect(open.items.every((i) => i.documentNumber !== null)).toBe(true)
    expect(open.items.map((i) => i.id)).not.toContain(draft.id)
    expect(open.total).toBe(2)
    expect(open.counts).toEqual(all.counts)
    expect(open.totals).toEqual(all.totals)
    expect(open.items.find((i) => i.id === partial.id)!.remaining).toBe(120)

    const overdueTab = await list('tab=overdue')
    expect(overdueTab.items.map((i) => i.id)).toEqual([overdue.id])
    expect(overdueTab.items[0]!.isOverdue).toBe(true)

    expect((await list('tab=paid')).items.map((i) => i.id)).toEqual([paid.id])
    expect((await list('tab=rejected')).items.map((i) => i.id)).toEqual([rejected.id])
    expect((await list('tab=draft')).items.map((i) => i.id)).toEqual([draft.id])

    const page1 = await list('tab=all&pageSize=2&page=1')
    const page3 = await list('tab=all&pageSize=2&page=3')
    expect(page1.items).toHaveLength(2)
    expect(page1.total).toBe(5)
    expect(page3.items).toHaveLength(1)
    expect(page3.total).toBe(5)
  })
})

describe('reconciliation without drafts', () => {
  beforeEach(() => maybeExtendMock.mockClear())

  it('open-invoices lists numbered invoices with a balance and leaves out drafts and paid ones', async () => {
    const unpaid = await makeIssued({ amount: '100.00' })
    const partial = await makeIssued({ amount: '100.00' })
    await addPayment(partial.id, { amount: 30, paidAt: today, method: 'cash' })
    const paid = await makeIssued({ amount: '100.00' })
    await addPayment(paid.id, { amount: 100, paidAt: today, method: 'cash' })
    const draft = await makeDraftRow({ amount: '100.00' })

    const res = await api('GET', '/api/reconciliation/open-invoices')
    expect(res.status).toBe(200)
    const rows = res.body.data as Array<{ id: string; remaining: number }>
    const ids = rows.map((r) => r.id)
    expect(ids).toContain(unpaid.id)
    expect(ids).toContain(partial.id)
    expect(rows.find((r) => r.id === partial.id)!.remaining).toBe(70)
    expect(ids).not.toContain(paid.id)
    expect(ids).not.toContain(draft.id)
  })

  it('automatic matching skips a draft even when amount and IBAN fit', async () => {
    const iban = 'RO49AAAA1B31007593840000'
    const client = await makeClient({ iban })
    const draft = await makeDraftRow({ amount: '3141.59', billingClientId: client.id, counterpartyName: client.name })
    const txn = await makeBankTxn('3141.59', { counterpartyIban: iban })

    await autoMatchTransactions()

    expect(await db.select().from(paymentMatches).where(eq(paymentMatches.bankTransactionId, txn.id))).toHaveLength(0)
    expect(await db.select().from(invoicePayments).where(eq(invoicePayments.recordId, draft.id))).toHaveLength(0)
  })

  it('automatic matching pays a partly paid invoice with the transaction for its balance, and leaves a smaller one alone', async () => {
    const iban = 'RO49AAAA1B31007593840001'
    const client = await makeClient({ iban })
    const invoice = await makeIssued({ amount: '1234.56', billingClientId: client.id, counterpartyName: client.name })
    await addPayment(invoice.id, { amount: 400, paidAt: today, method: 'cash' })
    expect((await recordRow(invoice.id))!.paymentStatus).toBe('partial')

    // The score needs the amount to equal the balance (834.56): 300 matches nothing.
    const smaller = await makeBankTxn('300.00', { counterpartyIban: iban })
    await autoMatchTransactions()
    expect(await db.select().from(paymentMatches).where(eq(paymentMatches.bankTransactionId, smaller.id))).toHaveLength(0)
    expect((await recordRow(invoice.id))!.paymentStatus).toBe('partial')

    const balance = await makeBankTxn('834.56', { counterpartyIban: iban })
    await autoMatchTransactions()
    const [match] = await db.select().from(paymentMatches).where(eq(paymentMatches.bankTransactionId, balance.id))
    expect(match?.paymentId).toBeTruthy()
    expect((await recordRow(invoice.id))!.paymentStatus).toBe('paid')
  })

  it('a manual match of a smaller transaction records a bank payment and leaves the invoice partial', async () => {
    const invoice = await makeIssued({ amount: '500.00' })
    const txn = await makeBankTxn('200.00')

    const res = await api('POST', `/api/reconciliation/transactions/${txn.id}/match`, { financialRecordId: invoice.id })
    expect(res.status).toBe(201)

    expect((await recordRow(invoice.id))!.paymentStatus).toBe('partial')
    const payments = await db.select().from(invoicePayments).where(eq(invoicePayments.recordId, invoice.id))
    expect(payments.map((p) => [p.method, p.amount])).toEqual([['bank', '200.00']])
  })
})

describe('audit trail', () => {
  it('writes a row for draft create, edit and delete', async () => {
    const client = await makeClient()
    const draft = await createDraft(api, client.id)
    expect((await api('PATCH', `/api/invoicing/invoices/${draft.id}`, { note: 'schimbat' })).status).toBe(200)
    expect((await api('DELETE', `/api/invoicing/invoices/${draft.id}`)).status).toBe(200)

    expect(await auditActions(draft.id)).toEqual(['factura.ciorna.creata', 'factura.ciorna.editata', 'factura.ciorna.stearsa'])
  })

  it('writes a row for adding and removing a payment', async () => {
    const client = await makeClient()
    const invoice = await createIssued(api, client.id)

    const added = await api('POST', `/api/invoicing/invoices/${invoice.id}/payments`, { amount: 50, paidAt: today, method: 'cash' })
    expect(added.status).toBe(201)
    const removed = await api('DELETE', `/api/invoicing/invoices/${invoice.id}/payments/${added.body.data.id}`)
    expect(removed.status).toBe(200)

    const actions = await auditActions(invoice.id)
    expect(actions).toEqual(expect.arrayContaining(['factura.emitata', 'factura.plata.adaugata', 'factura.plata.stearsa']))
    const rows = await db.select({ actor: auditLog.actorUserId }).from(auditLog).where(eq(auditLog.entityId, invoice.id))
    expect(rows.every((r) => r.actor !== null)).toBe(true)
  })
})

describe('document page', () => {
  it('returns payments, remaining, timeline and the same-client count', async () => {
    const client = await makeClient()
    const invoice = await createIssued(api, client.id)
    // 2 x 100 + 19% VAT = 238.00
    await makeIssued({ amount: '50.00', currency: 'EUR', billingClientId: client.id, counterpartyName: client.name })
    await addPayment(invoice.id, { amount: 100, paidAt: today, method: 'bank', reference: 'OP 1' })

    const res = await api('GET', `/api/accounting/records/${invoice.id}/detail`)
    expect(res.status).toBe(200)
    const detail = res.body.data
    expect(detail.record.id).toBe(invoice.id)
    expect(detail.totals).toEqual({ net: 200, vat: 38, gross: 238 })
    expect(detail.lines).toHaveLength(1)
    expect(detail.payments).toHaveLength(1)
    expect(detail.payments[0]).toMatchObject({ amount: 100, method: 'bank', reference: 'OP 1', currency: 'EUR' })
    expect(detail.remaining).toBe(138)
    const kinds = detail.timeline.map((entry: { kind: string }) => entry.kind)
    expect(kinds).toEqual(expect.arrayContaining(['factura.ciorna.creata', 'factura.emitata', 'factura.plata.adaugata']))
    expect(detail.sameClient).toEqual({ count: 2, total: 288, currency: 'EUR' })
  })

  it('answers 404 for an id that does not exist', async () => {
    const res = await api('GET', '/api/accounting/records/00000000-0000-4000-8000-000000000000/detail')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('RECORD_NOT_FOUND')
  })
})

describe('payment recorded from the invoice page', () => {
  it('settling the invoice extends the subscription once, with the mark-paid key; a partial payment does not', async () => {
    const client = await makeClient()
    const invoice = await createIssued(api, client.id)
    maybeExtendMock.mockClear()

    const partial = await api('POST', `/api/invoicing/invoices/${invoice.id}/payments`, { amount: 10, paidAt: today, method: 'bank' })
    expect(partial.status).toBe(201)
    expect(maybeExtendMock).not.toHaveBeenCalled()

    const rest = Number(invoice.amount) - 10
    const settled = await api('POST', `/api/invoicing/invoices/${invoice.id}/payments`, { amount: rest, paidAt: today, method: 'bank' })
    expect(settled.status).toBe(201)
    expect(maybeExtendMock).toHaveBeenCalledTimes(1)
    expect(maybeExtendMock).toHaveBeenCalledWith({ billingClientId: client.id, source: 'mark_paid', sourceId: `mark-paid:${invoice.id}` })
  })
})
