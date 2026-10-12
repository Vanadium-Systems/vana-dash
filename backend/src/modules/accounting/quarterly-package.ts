import { Readable } from 'node:stream'
import { zipSync } from 'fflate'
import { and, eq, gte, isNull, lt, ne, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { bankTransactions, financialRecords, paymentMatches } from '../../shared/db/schema/index.js'
import { collectArchiveFilesForMonths } from '../../shared/lib/archive-export.js'
import { ronAmountSql } from '../../shared/lib/sql-fx.js'
import { getPresignedDownloadUrl, uploadToR2 } from '../../shared/lib/r2.js'

// The quarterly package for the accountant: what the app already keeps (invoices, archive,
// reconciliation, expenses, reverse charge), packed once every three months. A person sends
// it; nothing here emails a third party on its own.

const QUARTER_MONTHS: Record<string, [number, number, number]> = {
  Q1: [1, 2, 3],
  Q2: [4, 5, 6],
  Q3: [7, 8, 9],
  Q4: [10, 11, 12],
}

export function parseQuarter(quarter: string): { from: Date; to: Date; monthFolderNames: string[] } {
  const match = /^(\d{4})-(Q[1-4])$/.exec(quarter)
  if (!match) throw new Error(`Format trimestru invalid: "${quarter}" (așteptat YYYY-Qn)`)
  const year = Number(match[1])
  const months = QUARTER_MONTHS[match[2]!]!
  const from = new Date(Date.UTC(year, months[0] - 1, 1))
  const to = new Date(Date.UTC(year, months[2], 1))
  const monthFolderNames = months.map((m) => `${String(m).padStart(2, '0')}-${year}`)
  return { from, to, monthFolderNames }
}

export interface QuarterlyPackageSummary {
  quarter: string
  period: { from: string; to: string }
  invoicesIssued: number
  invoicesReceived: number
  revenueRon: number
  expensesRon: number
  unmatchedBankTransactions: number
  reverseChargeLines: number
}

export async function getQuarterlyPackageSummary(quarter: string): Promise<QuarterlyPackageSummary> {
  const { from, to } = parseQuarter(quarter)
  const dateFilter = and(gte(financialRecords.issuedAt, from), lt(financialRecords.issuedAt, to), isNull(financialRecords.deletedAt))

  const [[issued], [received], [revenue], [expenses], [unmatched], [reverseCharge]] = await Promise.all([
    db.select({ count: sql<number>`COUNT(*)::int` }).from(financialRecords).where(
      and(dateFilter, eq(financialRecords.direction, 'out'), eq(financialRecords.type, 'invoice')),
    ),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(financialRecords).where(
      and(dateFilter, eq(financialRecords.direction, 'in'), eq(financialRecords.type, 'invoice')),
    ),
    db
      .select({ total: sql<number>`COALESCE(SUM(${ronAmountSql(financialRecords.amount, financialRecords.currency, financialRecords.issuedAt)}), 0)` })
      .from(financialRecords)
      .where(and(dateFilter, eq(financialRecords.direction, 'out'))),
    db
      .select({ total: sql<number>`COALESCE(SUM(${ronAmountSql(financialRecords.amount, financialRecords.currency, financialRecords.issuedAt)}), 0)` })
      .from(financialRecords)
      .where(and(dateFilter, eq(financialRecords.direction, 'in'))),
    db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(bankTransactions)
      .leftJoin(paymentMatches, eq(paymentMatches.bankTransactionId, bankTransactions.id))
      .where(
        and(
          gte(bankTransactions.valueDate, from),
          lt(bankTransactions.valueDate, to),
          isNull(bankTransactions.deletedAt),
          isNull(paymentMatches.id),
        ),
      ),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(financialRecords).where(
      and(dateFilter, ne(financialRecords.reverseChargeType, 'none')),
    ),
  ])

  return {
    quarter,
    period: { from: from.toISOString(), to: to.toISOString() },
    invoicesIssued: issued!.count,
    invoicesReceived: received!.count,
    revenueRon: Number(revenue!.total),
    expensesRon: Number(expenses!.total),
    unmatchedBankTransactions: unmatched!.count,
    reverseChargeLines: reverseCharge!.count,
  }
}

function summaryToCsv(summary: QuarterlyPackageSummary): string {
  const rows = [
    ['Trimestru', summary.quarter],
    ['Perioadă', `${summary.period.from.slice(0, 10)} → ${summary.period.to.slice(0, 10)}`],
    ['Facturi emise', String(summary.invoicesIssued)],
    ['Facturi primite', String(summary.invoicesReceived)],
    ['Venituri (RON)', summary.revenueRon.toFixed(2)],
    ['Cheltuieli (RON)', summary.expensesRon.toFixed(2)],
    ['Tranzacții bancare nereconciliate', String(summary.unmatchedBankTransactions)],
    ['Linii taxare inversă (D301/D390)', String(summary.reverseChargeLines)],
  ]
  return rows.map((r) => r.join(',')).join('\n')
}

export interface QuarterlyPackageResult {
  summary: QuarterlyPackageSummary
  zipR2Key: string
  downloadUrl: string
}

export async function buildQuarterlyPackage(quarter: string): Promise<QuarterlyPackageResult> {
  const { monthFolderNames } = parseQuarter(quarter)
  const [summary, archiveFiles] = await Promise.all([
    getQuarterlyPackageSummary(quarter),
    collectArchiveFilesForMonths(monthFolderNames),
  ])

  const zipEntries: Record<string, Uint8Array> = {
    'sumar.csv': new TextEncoder().encode(summaryToCsv(summary)),
  }
  for (const file of archiveFiles) {
    zipEntries[file.zipPath] = new Uint8Array(file.buffer)
  }

  const zipBuffer = Buffer.from(zipSync(zipEntries))
  const zipR2Key = `quarterly-packages/${quarter}.zip`
  await uploadToR2(zipR2Key, Readable.from(zipBuffer), 'application/zip')
  const downloadUrl = await getPresignedDownloadUrl(zipR2Key, 900)

  return { summary, zipR2Key, downloadUrl }
}
