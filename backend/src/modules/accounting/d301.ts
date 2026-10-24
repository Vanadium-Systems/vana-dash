import { and, eq, gte, isNull, lt, ne } from 'drizzle-orm'
import type { z } from 'zod'
import { config } from '../../shared/config.js'
import { buildD301 } from '../../connectors/anaf/declarations/d301-builder.js'
import { buildD390 } from '../../connectors/anaf/declarations/d390-builder.js'
import { D301_TEMPLATE, D390_TEMPLATE, fillXfaDatasets } from '../../connectors/anaf/declarations/xfa-pdf.js'
import type { DeclarationLine } from '../../connectors/anaf/declarations/types.js'
import { db } from '../../shared/db/client.js'
import { financialRecords } from '../../shared/db/schema/index.js'
import { getRateForDate } from '../../shared/lib/bnr.js'
import type { DeclarationLineUpdateSchema } from './schema.js'

const DEFAULT_VAT_RATE = 21

function monthBounds(period: string): { from: Date; to: Date } {
  const [year, month] = period.split('-').map(Number)
  const from = new Date(Date.UTC(year!, month! - 1, 1))
  const to = new Date(Date.UTC(year!, month!, 1))
  return { from, to }
}

/** Rândurile brute din financial_records + conversia RON (curs BNR la data facturii) per linie. */
async function loadLines(period: string): Promise<{ lines: DeclarationLine[]; warnings: string[] }> {
  const { from, to } = monthBounds(period)
  const rows = await db
    .select()
    .from(financialRecords)
    .where(
      and(
        isNull(financialRecords.deletedAt),
        eq(financialRecords.direction, 'in'),
        ne(financialRecords.reverseChargeType, 'none'),
        gte(financialRecords.issuedAt, from),
        lt(financialRecords.issuedAt, to),
      ),
    )
    .orderBy(financialRecords.issuedAt)

  const warnings: string[] = []
  const lines: DeclarationLine[] = []

  for (const row of rows) {
    const amount = Number(row.amount)
    const currency = row.currency
    let fxRate = 1
    if (currency !== 'RON') {
      try {
        const rate = await getRateForDate(row.issuedAt.toISOString().slice(0, 10), currency)
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

    if (!row.documentNumber) {
      warnings.push(`${row.counterpartyName ?? row.id} din ${row.issuedAt.toISOString().slice(0, 10)}: lipsește numărul facturii — completează-l cu creionul de pe rând`)
    }
    if (row.reverseChargeType === 'eu_services' && (!row.counterpartyCountry || !row.counterpartyCif)) {
      warnings.push(`${row.documentNumber ?? row.id}: lipsește țara sau codul TVA al furnizorului — obligatoriu pt. D390`)
    }
    if (row.reverseChargeType === 'eu_services' && !config.company.vatIntraCommunityCode) {
      warnings.push(`${row.documentNumber ?? row.id}: COMPANY_VAT_INTRA_CODE nesetat — obligatoriu pt. achiziții eu_services`)
    }

    lines.push({
      recordId: row.id,
      reverseChargeType: row.reverseChargeType as 'eu_services' | 'non_eu_services',
      documentNumber: row.documentNumber ?? '',
      issuedAt: row.issuedAt,
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

export interface DeclarationPreview {
  period: string
  lines: DeclarationLine[]
  totals: { baseRon: number; vatRon: number }
  warnings: string[]
}

export async function generateD301Preview(period: string): Promise<DeclarationPreview> {
  const { lines, warnings } = await loadLines(period)
  const baseRon = Math.round(lines.reduce((sum, l) => sum + l.baseRon, 0) * 100) / 100
  const vatRon = Math.round(lines.reduce((sum, l) => sum + l.vatRon, 0) * 100) / 100
  return { period, lines, totals: { baseRon, vatRon }, warnings }
}

export async function generateD390Preview(period: string): Promise<DeclarationPreview> {
  const { lines, warnings } = await loadLines(period)
  const euLines = lines.filter((l) => l.reverseChargeType === 'eu_services')
  const baseRon = Math.round(euLines.reduce((sum, l) => sum + l.baseRon, 0) * 100) / 100
  return { period, lines: euLines, totals: { baseRon, vatRon: 0 }, warnings }
}

function requireCompanyIdentity() {
  if (!config.company.cif) throw new Error('COMPANY_CIF nesetat')
  return {
    cif: config.company.cif,
    name: config.company.name,
    address: config.company.address,
    bank: config.company.bank,
    iban: config.company.iban,
    vatIntraCommunityCode: config.company.vatIntraCommunityCode,
  }
}

function requireDeclarant() {
  if (!config.declarant.firstName || !config.declarant.lastName) {
    throw new Error('DECLARANT_FIRST_NAME/DECLARANT_LAST_NAME nesetate')
  }
  return config.declarant
}

async function d301For(period: string) {
  const { lines } = await loadLines(period)
  return buildD301(period, lines, requireCompanyIdentity(), requireDeclarant())
}

async function d390For(period: string) {
  const { lines } = await loadLines(period)
  const company = requireCompanyIdentity()
  if (!company.vatIntraCommunityCode) {
    throw new Error('COMPANY_VAT_INTRA_CODE nesetat — obligatoriu pt. D390')
  }
  return buildD390(period, lines, company, requireDeclarant())
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

export function declarationFileName(code: 'D301' | 'D390', period: string, ext: 'xml' | 'pdf'): string {
  const [year, month] = period.split('-')
  return `${code}_${config.company.cif}_${year}_${month}.${ext}`
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
