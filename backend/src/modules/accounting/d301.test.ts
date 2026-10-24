/**
 * modules/accounting/d301.ts — agregare D301/D390 din financial_records. Integration test, pg
 * real (test/setup.ts). Verifică: filtrare pe reverse_charge_type != 'none', separarea eu/non-eu
 * la D390, luna goală, și warning-ul pt. curs BNR indisponibil (nu crapă — regula #7 CLAUDE.md).
 */
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { financialRecords } from '../../shared/db/schema/index.js'
import { declarationAddress, generateD301Preview, generateD390Preview, linesToCsv, saveFiling, updateDeclarationLine } from './d301.js'

const recordIds: string[] = []

afterAll(async () => {
  if (recordIds.length) await db.delete(financialRecords).where(inArray(financialRecords.id, recordIds))
})

async function insertExpense(overrides: Partial<typeof financialRecords.$inferInsert>) {
  const [row] = await db
    .insert(financialRecords)
    .values({
      type: 'expense',
      direction: 'in',
      amount: '100.00',
      currency: 'RON',
      issuedAt: new Date('2026-07-10T00:00:00Z'),
      source: 'manual',
      reverseChargeType: 'none',
      ...overrides,
    })
    .returning()
  recordIds.push(row!.id)
  return row!
}

describe('generateD301Preview', () => {
  it('returns an empty preview for a month with no reverse-charge lines', async () => {
    await insertExpense({ reverseChargeType: 'none', issuedAt: new Date('2026-09-05T00:00:00Z') })
    const preview = await generateD301Preview('2026-09')
    expect(preview.lines).toHaveLength(0)
    expect(preview.totals).toEqual({ baseRon: 0, vatRon: 0 })
  })

  it('includes eu_services and non_eu_services lines from financial_records in RON, with 21% default VAT', async () => {
    await insertExpense({
      documentNumber: 'HTZ-D301-1',
      currency: 'RON',
      amount: '500.00',
      reverseChargeType: 'eu_services',
      counterpartyCountry: 'DE',
      counterpartyCif: '123456789',
      counterpartyName: 'Hetzner Online GmbH',
      issuedAt: new Date('2026-10-05T00:00:00Z'),
    })
    await insertExpense({
      documentNumber: 'CF-D301-1',
      currency: 'RON',
      amount: '200.00',
      reverseChargeType: 'non_eu_services',
      counterpartyCountry: 'US',
      counterpartyName: 'Cloudflare Inc',
      issuedAt: new Date('2026-10-08T00:00:00Z'),
    })

    const preview = await generateD301Preview('2026-10')
    expect(preview.lines).toHaveLength(2)
    expect(preview.totals.baseRon).toBeCloseTo(700)
    expect(preview.totals.vatRon).toBeCloseTo(147) // 21% din 700
  })

  it('excludes a line and warns when no BNR rate exists for a non-RON currency on that date', async () => {
    await insertExpense({
      documentNumber: 'HTZ-D301-2',
      currency: 'EUR',
      amount: '50.00',
      reverseChargeType: 'eu_services',
      counterpartyCountry: 'DE',
      counterpartyCif: '999',
      counterpartyName: 'Hetzner Online GmbH',
      // an foarte vechi, aproape sigur fără curs seed-uit în DB local
      issuedAt: new Date('2001-01-15T00:00:00Z'),
    })
    const preview = await generateD301Preview('2001-01')
    expect(preview.lines).toHaveLength(0)
    expect(preview.warnings.some((w) => w.includes('curs BNR indisponibil'))).toBe(true)
  })

  it('warns when an eu_services line lacks counterparty country/VAT id', async () => {
    await insertExpense({
      documentNumber: 'HTZ-D301-3',
      currency: 'RON',
      amount: '10.00',
      reverseChargeType: 'eu_services',
      counterpartyCountry: null,
      counterpartyCif: null,
      issuedAt: new Date('2026-11-05T00:00:00Z'),
    })
    const preview = await generateD301Preview('2026-11')
    expect(preview.warnings.some((w) => w.includes('lipsește țara sau codul TVA'))).toBe(true)
  })
})

describe('generateD390Preview', () => {
  it('includes only eu_services lines, never non_eu_services', async () => {
    await insertExpense({
      documentNumber: 'HTZ-D390-1',
      currency: 'RON',
      amount: '300.00',
      reverseChargeType: 'eu_services',
      counterpartyCountry: 'DE',
      counterpartyCif: '111',
      counterpartyName: 'Hetzner Online GmbH',
      issuedAt: new Date('2026-12-05T00:00:00Z'),
    })
    await insertExpense({
      documentNumber: 'CF-D390-1',
      currency: 'RON',
      amount: '80.00',
      reverseChargeType: 'non_eu_services',
      counterpartyCountry: 'US',
      counterpartyName: 'Cloudflare Inc',
      issuedAt: new Date('2026-12-06T00:00:00Z'),
    })

    const preview = await generateD390Preview('2026-12')
    expect(preview.lines).toHaveLength(1)
    expect(preview.lines[0]!.reverseChargeType).toBe('eu_services')
    expect(preview.totals.baseRon).toBeCloseTo(300)
  })
})

describe('linesToCsv', () => {
  it('produces a header row plus one row per line', async () => {
    await insertExpense({
      documentNumber: 'HTZ-CSV-1',
      currency: 'RON',
      amount: '100.00',
      reverseChargeType: 'eu_services',
      counterpartyCountry: 'DE',
      counterpartyCif: '222',
      counterpartyName: 'Hetzner Online GmbH',
      issuedAt: new Date('2027-01-05T00:00:00Z'),
    })
    const preview = await generateD301Preview('2027-01')
    const csv = linesToCsv(preview.lines)
    const rows = csv.trim().split('\n')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toBe('tip,document,data,suma_valuta,valuta,curs,baza_ron,tva_ron,tara,cod_tva_furnizor,furnizor')
    expect(rows[1]).toContain('HTZ-CSV-1')
  })
})

describe('updateDeclarationLine', () => {
  it('fills in the invoice number of a recurring expense and can take the line out', async () => {
    const row = await insertExpense({
      currency: 'RON',
      amount: '50.00',
      reverseChargeType: 'eu_services',
      counterpartyCountry: 'IE',
      counterpartyCif: 'IE1234567T',
      counterpartyName: 'Acme Ireland Ltd',
      issuedAt: new Date('2027-02-05T00:00:00Z'),
    })

    const before = await generateD301Preview('2027-02')
    expect(before.lines[0]!.documentNumber).toBe('')
    expect(before.warnings.some((w) => w.includes('lipsește numărul facturii'))).toBe(true)

    await updateDeclarationLine(row.id, { documentNumber: 'INV-ACME-7', amount: 60 })
    const fixed = await generateD301Preview('2027-02')
    expect(fixed.lines[0]!.documentNumber).toBe('INV-ACME-7')
    expect(fixed.totals.baseRon).toBeCloseTo(60)

    await updateDeclarationLine(row.id, { reverseChargeType: 'none' })
    expect((await generateD301Preview('2027-02')).lines).toHaveLength(0)
  })
})

describe('recurring expenses in declarations', () => {
  it('shows a recurring line without an invoice number but leaves it out until the invoice is set', async () => {
    const row = await insertExpense({
      currency: 'RON',
      amount: '40.00',
      reverseChargeType: 'non_eu_services',
      counterpartyCountry: 'US',
      counterpartyName: 'Acme Cloud Inc',
      source: 'recurring_expense',
      issuedAt: new Date('2027-03-05T00:00:00Z'),
    })

    const before = await generateD301Preview('2027-03')
    expect(before.lines).toHaveLength(1)
    expect(before.lines[0]!.confirmed).toBe(false)
    expect(before.totals.baseRon).toBe(0)

    await updateDeclarationLine(row.id, { documentNumber: 'INV-ACME-8' })
    const after = await generateD301Preview('2027-03')
    expect(after.lines[0]!.confirmed).toBe(true)
    expect(after.totals.baseRon).toBeCloseTo(40)
  })
})

describe('declarationAddress', () => {
  it('writes county, locality, street and postal code in the order the forms ask for', () => {
    const address = declarationAddress({ address: 'Str. Exemplu 1, Bl. 2', city: 'Cluj-Napoca', countyCode: 'RO-CJ', postalCode: '400001' })
    expect(address).toBe('JUD. CLUJ, Cluj-Napoca, Str. Exemplu 1, Bl. 2, COD POSTAL 400001')
  })

  it('skips the county for Bucharest and an empty postal code', () => {
    expect(declarationAddress({ address: 'Str. Exemplu 1', city: 'Bucuresti Sector 1', countyCode: 'RO-B', postalCode: '' })).toBe(
      'Bucuresti Sector 1, Str. Exemplu 1',
    )
  })
})

describe('saveFiling', () => {
  it('keeps one SPV index per declaration and month, the latest one typed in', async () => {
    expect((await generateD301Preview('2027-04')).filing).toBeNull()

    await saveFiling('D301', { month: '2027-04', anafIndex: '1000000001' })
    await saveFiling('D301', { month: '2027-04', anafIndex: '1000000002' })
    expect((await generateD301Preview('2027-04')).filing?.anafIndex).toBe('1000000002')
    expect((await generateD390Preview('2027-04')).filing).toBeNull()
  })
})
