import { and, eq, gte, isNull, lt, ne, or, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { buildD301 } from '../../connectors/anaf/declarations/d301-builder.js'
import { buildD390 } from '../../connectors/anaf/declarations/d390-builder.js'
import { D301_TEMPLATE, D390_TEMPLATE, fillXfaDatasets } from '../../connectors/anaf/declarations/xfa-pdf.js'
import type { DeclarationLine } from '../../connectors/anaf/declarations/types.js'
import { db } from '../../shared/db/client.js'
import { declarationFilings, financialRecords } from '../../shared/db/schema/index.js'
import { getRateForDate } from '../../shared/lib/bnr.js'
import { getCompany, requireSeller } from '../../shared/lib/company.js'
import { CompanyProfileIncompleteError } from '../../countries/types.js'
import { isoCodeToCountyName } from '../../shared/lib/ro-counties.js'
import type { DeclarationFilingBodySchema, DeclarationLineUpdateSchema } from './schema.js'

const DEFAULT_VAT_RATE = 21

function monthBounds(period: string): { from: Date; to: Date } {
  const [year, month] = period.split('-').map(Number)
  const from = new Date(Date.UTC(year!, month! - 1, 1))
  const to = new Date(Date.UTC(year!, month!, 1))
  return { from, to }
}

/**
 * Set on an invoice that was first billed with VAT and later turned into reverse charge by a credit
 * note: the invoice keeps its own date for the books, while D301 takes it in the month of the credit
 * note, under the credit note's number and at that day's rate.
 */
interface ReverseChargeAdjustment {
  documentNumber: string
  date: string
}

function adjustmentOf(meta: unknown): ReverseChargeAdjustment | null {
  const adj = (meta as { reverseChargeAdjustment?: Partial<ReverseChargeAdjustment> } | null)?.reverseChargeAdjustment
  return adj?.documentNumber && adj.date ? { documentNumber: adj.documentNumber, date: adj.date } : null
}

/** Rândurile brute din financial_records + conversia RON (curs BNR la data facturii) per linie. */
async function loadLines(period: string): Promise<{ lines: DeclarationLine[]; warnings: string[] }> {
  const { from, to } = monthBounds(period)
  const adjustmentDate = sql`(${financialRecords.meta} -> 'reverseChargeAdjustment' ->> 'date')`
  const rows = await db
    .select()
    .from(financialRecords)
    .where(
      and(
        isNull(financialRecords.deletedAt),
        eq(financialRecords.direction, 'in'),
        ne(financialRecords.reverseChargeType, 'none'),
        or(
          and(sql`${adjustmentDate} IS NULL`, gte(financialRecords.issuedAt, from), lt(financialRecords.issuedAt, to)),
          and(sql`${adjustmentDate} >= ${from.toISOString().slice(0, 10)}`, sql`${adjustmentDate} < ${to.toISOString().slice(0, 10)}`),
        ),
      ),
    )
    .orderBy(financialRecords.issuedAt)

  const { profile } = await getCompany()
  const warnings: string[] = []
  const lines: DeclarationLine[] = []

  for (const row of rows) {
    const adjustment = adjustmentOf(row.meta)
    const lineDate = adjustment ? new Date(`${adjustment.date}T00:00:00Z`) : row.issuedAt
    const amount = Number(row.amount)
    const currency = row.currency
    let fxRate = 1
    if (currency !== 'RON') {
      try {
        const rate = await getRateForDate(lineDate.toISOString().slice(0, 10), currency)
        fxRate = Number(rate.rate)
      } catch (err) {
        warnings.push(`${row.documentNumber ?? row.id}: curs BNR indisponibil pt. ${currency} — exclus din total (${String(err)})`)
        continue
      }
    }
    const vatRate = row.reverseChargeVatRate ? Number(row.reverseChargeVatRate) : DEFAULT_VAT_RATE
    // VAT from the unrounded base, as the accountant computes it: rounding the base first can move it by one ban.
    const baseRon = Math.round(amount * fxRate * 100) / 100
    const vatRon = Math.round(((amount * fxRate * vatRate) / 100) * 100) / 100

    const confirmed = row.source !== 'recurring_expense' || Boolean(row.documentNumber)
    const label = `${row.counterpartyName ?? row.id} din ${row.issuedAt.toISOString().slice(0, 10)}`
    if (!confirmed) {
      warnings.push(`${label}: abonament recurent, fără factură — nu intră în declarație până nu pui numărul, data și suma de pe factura reală (creionul de pe rând)`)
    } else if (!row.documentNumber) {
      warnings.push(`${label}: lipsește numărul facturii — completează-l cu creionul de pe rând`)
    }
    if (row.reverseChargeType === 'eu_services' && (!row.counterpartyCountry || !row.counterpartyCif)) {
      warnings.push(`${row.documentNumber ?? row.id}: lipsește țara sau codul TVA al furnizorului — obligatoriu pt. D390`)
    }
    if (row.reverseChargeType === 'eu_services' && !profile.vatIntraCode) {
      warnings.push(`${row.documentNumber ?? row.id}: lipsește codul de TVA special din fișa firmei (Setări → Date firmă) — obligatoriu pt. achiziții eu_services`)
    }

    lines.push({
      recordId: row.id,
      confirmed,
      reverseChargeType: row.reverseChargeType as 'eu_services' | 'non_eu_services',
      documentNumber: adjustment?.documentNumber ?? row.documentNumber ?? '',
      issuedAt: lineDate,
      amountForeign: amount,
      currency,
      fxRate,
      baseRon,
      vatRon,
      counterpartyCountry: row.counterpartyCountry,
      counterpartyVatId: row.counterpartyCif,
      counterpartyName: row.counterpartyName ?? '',
    })
  }

  return { lines, warnings }
}

export type DeclarationCode = 'D301' | 'D390'

export interface DeclarationFiling {
  anafIndex: string
  filedAt: Date
  confirmedAt: Date | null
}

export interface DeclarationPreview {
  period: string
  lines: DeclarationLine[]
  totals: { baseRon: number; vatRon: number }
  warnings: string[]
  /** Set once the index ANAF gave at upload has been typed in. */
  filing: DeclarationFiling | null
}

async function getFiling(code: DeclarationCode, period: string): Promise<DeclarationFiling | null> {
  const [row] = await db
    .select({ anafIndex: declarationFilings.anafIndex, filedAt: declarationFilings.filedAt, confirmedAt: declarationFilings.confirmedAt })
    .from(declarationFilings)
    .where(and(eq(declarationFilings.code, code), eq(declarationFilings.period, period), isNull(declarationFilings.deletedAt)))
  return row ?? null
}

export async function saveFiling(code: DeclarationCode, input: z.infer<typeof DeclarationFilingBodySchema>): Promise<DeclarationFiling> {
  const filedAt = input.filedAt ?? new Date()
  const [row] = await db
    .insert(declarationFilings)
    .values({ code, period: input.month, anafIndex: input.anafIndex.trim(), filedAt })
    .onConflictDoUpdate({
      target: [declarationFilings.tenantId, declarationFilings.code, declarationFilings.period],
      set: { anafIndex: input.anafIndex.trim(), filedAt, confirmedAt: null, deletedAt: null, updatedAt: new Date() },
    })
    .returning({ anafIndex: declarationFilings.anafIndex, filedAt: declarationFilings.filedAt, confirmedAt: declarationFilings.confirmedAt })
  return row!
}

/** The SPV receipt is the proof the declaration was registered; its index wins over a typed one. */
export async function confirmFilingFromReceipt(code: DeclarationCode, period: string, anafIndex: string, receivedAt: Date): Promise<void> {
  await db
    .insert(declarationFilings)
    .values({ code, period, anafIndex, filedAt: receivedAt, confirmedAt: receivedAt })
    .onConflictDoUpdate({
      target: [declarationFilings.tenantId, declarationFilings.code, declarationFilings.period],
      set: { anafIndex, confirmedAt: receivedAt, deletedAt: null, updatedAt: new Date() },
    })
}

export async function generateD301Preview(period: string): Promise<DeclarationPreview> {
  const { lines, warnings } = await loadLines(period)
  const declared = lines.filter((l) => l.confirmed)
  const baseRon = Math.round(declared.reduce((sum, l) => sum + l.baseRon, 0) * 100) / 100
  const vatRon = Math.round(declared.reduce((sum, l) => sum + l.vatRon, 0) * 100) / 100
  return { period, lines, totals: { baseRon, vatRon }, warnings, filing: await getFiling('D301', period) }
}

export async function generateD390Preview(period: string): Promise<DeclarationPreview> {
  const { lines, warnings } = await loadLines(period)
  const euLines = lines.filter((l) => l.reverseChargeType === 'eu_services')
  const baseRon = Math.round(euLines.filter((l) => l.confirmed).reduce((sum, l) => sum + l.baseRon, 0) * 100) / 100
  return { period, lines: euLines, totals: { baseRon, vatRon: 0 }, warnings, filing: await getFiling('D390', period) }
}

/**
 * The declarations ask for the full address in one field, in this order: county, locality,
 * street and the rest, postal code. The seller address keeps them apart (the invoices need them
 * so), so the line is put together here.
 */
export function declarationAddress(company: { address: string; city: string; countyCode: string; postalCode: string }): string {
  const county = isoCodeToCountyName(company.countyCode)
  return [
    county && county !== 'BUCURESTI' ? `JUD. ${county}` : '',
    company.city,
    company.address,
    company.postalCode ? `COD POSTAL ${company.postalCode}` : '',
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ')
}

async function requireFiler() {
  const company = await getCompany()
  const seller = requireSeller(company)
  const { profile } = company
  if (!profile.declarant.firstName.trim() || !profile.declarant.lastName.trim()) {
    throw new CompanyProfileIncompleteError(['declarant'])
  }
  return {
    company: {
      cif: seller.cui,
      name: seller.name,
      address: declarationAddress({ ...seller.address, address: seller.address.street }),
      bank: profile.bank,
      iban: profile.iban,
      vatIntraCommunityCode: profile.vatIntraCode,
    },
    declarant: profile.declarant,
  }
}

async function confirmedLines(period: string): Promise<DeclarationLine[]> {
  const { lines } = await loadLines(period)
  return lines.filter((l) => l.confirmed)
}

async function d301For(period: string) {
  const lines = await confirmedLines(period)
  const { company, declarant } = await requireFiler()
  return buildD301(period, lines, company, declarant)
}

async function d390For(period: string) {
  const lines = await confirmedLines(period)
  const { company, declarant } = await requireFiler()
  if (!company.vatIntraCommunityCode) {
    throw new Error('Lipsește codul de TVA special din fișa firmei (Setări → Date firmă) — obligatoriu pt. D390')
  }
  return buildD390(period, lines, company, declarant)
}

export async function exportD301Xml(period: string): Promise<string> {
  return (await d301For(period)).xml
}

export async function exportD390Xml(period: string): Promise<string> {
  return (await d390For(period)).xml
}

/** The ANAF form, prefilled: open in Adobe Reader, press Validare, sign, upload to SPV. */
export async function exportD301Pdf(period: string): Promise<Buffer> {
  return fillXfaDatasets(D301_TEMPLATE, (await d301For(period)).datasets)
}

export async function exportD390Pdf(period: string): Promise<Buffer> {
  return fillXfaDatasets(D390_TEMPLATE, (await d390For(period)).datasets)
}

export async function declarationFileName(code: 'D301' | 'D390', period: string, ext: 'xml' | 'pdf'): Promise<string> {
  const [year, month] = period.split('-')
  return `${code}_${(await getCompany()).profile.cui}_${year}_${month}.${ext}`
}

function isUniqueViolation(err: unknown): boolean {
  const candidate = err as { code?: string; cause?: { code?: string } }
  return candidate?.code === '23505' || candidate?.cause?.code === '23505'
}

/**
 * Corrects a purchase as it goes into D301/D390. Recurring expenses are materialized with the
 * subscription's amount and due date and no invoice number, so the real invoice is typed here.
 * `reverseChargeType: 'none'` takes the line out of both declarations.
 */
export async function updateDeclarationLine(id: string, input: z.infer<typeof DeclarationLineUpdateSchema>) {
  try {
    const [row] = await db
      .update(financialRecords)
      .set({
        ...(input.documentNumber !== undefined ? { documentNumber: input.documentNumber.trim() || null } : {}),
        ...(input.issuedAt !== undefined ? { issuedAt: input.issuedAt } : {}),
        ...(input.amount !== undefined ? { amount: String(input.amount) } : {}),
        ...(input.reverseChargeType !== undefined ? { reverseChargeType: input.reverseChargeType } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(financialRecords.id, id), eq(financialRecords.direction, 'in'), isNull(financialRecords.deletedAt)))
      .returning({ id: financialRecords.id })
    return row ?? null
  } catch (err) {
    if (isUniqueViolation(err)) throw new Error(`Factura ${input.documentNumber} există deja în aplicație`)
    throw err
  }
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function linesToCsv(lines: DeclarationLine[]): string {
  const header = ['tip', 'document', 'data', 'suma_valuta', 'valuta', 'curs', 'baza_ron', 'tva_ron', 'tara', 'cod_tva_furnizor', 'furnizor']
  const rows = lines.map((l) =>
    [
      l.reverseChargeType,
      l.documentNumber,
      l.issuedAt.toISOString().slice(0, 10),
      l.amountForeign.toFixed(2),
      l.currency,
      l.fxRate.toFixed(4),
      l.baseRon.toFixed(2),
      l.vatRon.toFixed(2),
      l.counterpartyCountry ?? '',
      l.counterpartyVatId ?? '',
      l.counterpartyName,
    ]
      .map(String)
      .map(csvEscape)
      .join(','),
  )
  return [header.join(','), ...rows].join('\n')
}
