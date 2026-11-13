/**
 * QA4 of sprint 7, the colleague's path: a role with only facturi.view + facturi.emitere opens the
 * editor, picks a client, previews, saves, issues and records a partial payment, and no request
 * answers 403. The admin sees everything, so only a narrow role proves the catalog (2026-10-29: a
 * colleague's send failed on a route that needed a settings feature).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildServer } from '../src/app.js'
import { cleanup, makeClient, makeUser, RUN, trackRecord, useTestSequence } from './invoicing-fixtures.js'
import { makeApi, type Api } from './invoicing-http.js'

vi.mock('../src/shared/lib/pdf.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/shared/lib/pdf.js')>()),
  htmlToPdf: vi.fn(async () => Buffer.from('pdf')),
  isPdfAvailable: () => false,
}))

let app: Awaited<ReturnType<typeof buildServer>>
let colleague: Api

beforeAll(async () => {
  app = await buildServer()
  const user = await makeUser(app, ['facturi.view', 'facturi.emitere'])
  colleague = makeApi(app, user.cookie)
  await useTestSequence('invoice', `C${RUN}`)
})

afterAll(async () => {
  await cleanup()
  await app.close()
})

describe('colleague with facturi.view + facturi.emitere', () => {
  it('goes from an empty editor to a partly paid invoice without a 403', async () => {
    const client = await makeClient({ paymentTermsDays: 15 })
    const lines = [{ description: 'Servicii QA', quantity: 2, unitPrice: 250, vatRate: 19 }]
    const body = { billingClientId: client.id, currency: 'EUR', lines }

    const picker = await colleague('GET', '/api/invoicing/invoices/clients')
    expect(picker.status).toBe(200)
    const picked = (picker.body.data as Array<{ id: string; paymentTermsDays: number | null }>).find((c) => c.id === client.id)
    expect(picked?.paymentTermsDays).toBe(15)
    // The picker carries no client-file fields.
    expect(Object.keys(picked!).sort()).toEqual(['cif', 'id', 'name', 'paymentTermsDays'])

    expect((await colleague('GET', `/api/invoicing/invoices/clients/${client.id}/templates`)).status).toBe(200)
    expect((await colleague('GET', '/api/invoicing/invoices/next-number?key=invoice')).status).toBe(200)
    expect((await colleague('POST', '/api/invoicing/invoices/preview', body)).status).toBe(200)

    const created = await colleague('POST', '/api/invoicing/invoices', body)
    expect(created.status).toBe(201)
    const id = created.body.data.id as string
    trackRecord(id)

    const saved = await colleague('PATCH', `/api/invoicing/invoices/${id}`, { note: 'QA', expectedUpdatedAt: created.body.data.updatedAt })
    expect(saved.status).toBe(200)

    const issued = await colleague('POST', `/api/invoicing/invoices/${id}/issue`)
    expect(issued.status).toBe(200)
    expect(issued.body.data.documentNumber).toMatch(new RegExp(`^C${RUN}`))

    const paid = await colleague('POST', `/api/invoicing/invoices/${id}/payments`, { amount: 100, paidAt: '2026-11-13', method: 'bank' })
    expect(paid.status).toBe(201)

    const detail = await colleague('GET', `/api/accounting/records/${id}/detail`)
    expect(detail.status).toBe(200)
    expect(detail.body.data.record.paymentStatus).toBe('partial')
    expect(detail.body.data.remaining).toBeCloseTo(495, 2)

    expect((await colleague('GET', '/api/accounting/records?direction=out&tab=open&page=1&pageSize=10')).status).toBe(200)
  })

  it('cannot reach the client file, the series settings or ANAF', async () => {
    expect((await colleague('GET', '/api/invoicing/clients')).status).toBe(403)
    expect((await colleague('GET', '/api/invoicing/sequence')).status).toBe(403)
    expect((await colleague('GET', '/api/invoicing/anaf-lookup/RO12345678')).status).toBe(403)
  })
})
