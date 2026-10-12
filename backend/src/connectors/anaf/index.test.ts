/**
 * connectors/anaf/index.ts — knownMessageIds trebuie să sară peste descărcarea ZIP-ului
 * pt. mesajele deja sincronizate. Bug real (Stefan, 2026-08-01): fără filtrul ăsta, sync-ul
 * orar re-descărca ORICE mesaj din fereastra de 30 zile la fiecare rulare, indiferent dacă
 * era deja sincronizat — lovea garantat limita ANAF de 10 descărcări/zi/mesaj ("S-au facut
 * deja 10 descarcari la mesajul cu id_descarcare=..."), reprodusă live pe un mesaj real.
 */
import { zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnafSession } from '../types.js'
import { anafConnector } from './index.js'

const session: AnafSession = { cif: '12345674', accessToken: 'fake-token' }

const sampleUbl = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>FURN-2026-042</cbc:ID>
  <cbc:IssueDate>2026-06-14</cbc:IssueDate>
  <cbc:DueDate>2026-07-14</cbc:DueDate>
  <cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>RO87654321</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Furnizor Test SRL</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:LegalMonetaryTotal>
    <cbc:TaxInclusiveAmount currencyID="RON">1190.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="RON">1190.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`

function zipWithXml(): Uint8Array {
  return zipSync({ 'factura.xml': new TextEncoder().encode(sampleUbl) })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('fetchOutgoingInvoices — knownMessageIds', () => {
  it('sare peste descărcarea ZIP-ului pt. un mesaj deja cunoscut, descarcă doar mesajul nou', async () => {
    const descarcareCalls: string[] = []
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('listaMesajePaginatieFactura')) {
        return new Response(
          JSON.stringify({
            mesaje: [
              { id: 'known-1', data_creare: '202607010900', cif: '12345674', id_solicitare: '1', detalii: 'x', tip: 'FACTURA TRIMISA' },
              { id: 'new-1', data_creare: '202607020900', cif: '12345674', id_solicitare: '2', detalii: 'y', tip: 'FACTURA TRIMISA' },
            ],
            numar_total_pagini: 1,
          }),
          { status: 200 },
        )
      }
      if (url.includes('descarcare')) {
        const id = new URL(url).searchParams.get('id')!
        descarcareCalls.push(id)
        // known-1 n-ar trebui NICIODATĂ cerut — dacă se întâmplă, răspunsul ăsta
        // (eroare, nu zip) ar face parsarea să pice și testul să eșueze vizibil mai jos.
        if (id === 'known-1') {
          return new Response(JSON.stringify({ eroare: 'nu ar trebui cerut' }), { status: 200 })
        }
        return new Response(zipWithXml(), { status: 200 })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchSpy)

    const knownMessageIds = new Set(['known-1'])
    const invoices = await anafConnector.fetchOutgoingInvoices(
      session,
      new Date('2026-07-01T00:00:00Z'),
      new Date('2026-07-31T00:00:00Z'),
      knownMessageIds,
    )

    expect(descarcareCalls).toEqual(['new-1'])
    expect(invoices).toHaveLength(1)
    expect(invoices[0]!.anafMessageId).toBe('new-1')
  })

  it('knownMessageIds gol — descarcă toate mesajele (comportament neschimbat)', async () => {
    const descarcareCalls: string[] = []
    const fetchSpy = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('listaMesajePaginatieFactura')) {
        return new Response(
          JSON.stringify({
            mesaje: [{ id: 'a', data_creare: '202607010900', cif: '12345674', id_solicitare: '1', detalii: 'x', tip: 'FACTURA TRIMISA' }],
            numar_total_pagini: 1,
          }),
          { status: 200 },
        )
      }
      if (url.includes('descarcare')) {
        descarcareCalls.push(new URL(url).searchParams.get('id')!)
        return new Response(zipWithXml(), { status: 200 })
      }
      // transformare (fallback PDF, mesajul nostru de test n-are pdf în zip) — irelevant aici.
      return new Response(new Uint8Array(), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const invoices = await anafConnector.fetchOutgoingInvoices(
      session,
      new Date('2026-07-01T00:00:00Z'),
      new Date('2026-07-31T00:00:00Z'),
      new Set(),
    )

    expect(descarcareCalls).toEqual(['a'])
    expect(invoices).toHaveLength(1)
  })
})
