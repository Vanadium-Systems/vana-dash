import { and, desc, eq, gte, isNull, lte, ne, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { exchangeRates, financialRecords } from '../../shared/db/schema/index.js'
import { getCompany } from '../../shared/lib/company.js'
import { qualified } from '../../shared/lib/sql-fx.js'
import { isDraftSql, paidAmountSql, remainingSql } from '../../shared/lib/payments.js'
import { RECORD_TABS, type RecordsQuerySchema, type RecordTab } from './schema.js'
import { recordColumns, toPublicRow } from './service.js'

// Paged list with tabs, counts and totals, all in SQL. A tab is a state of the document;
// counts and totals ignore the tab so they stay put while the user switches between tabs.

const DEFAULT_PAGE_SIZE = 20

const isRejected = sql`${financialRecords.anafStatus} = 'rejected'`

function tabConditions(timeZone: string): Record<RecordTab, SQL> {
  const live = sql`NOT ${isDraftSql} AND ${financialRecords.anafStatus} IS DISTINCT FROM 'rejected'`
  const open = sql`${live} AND ${remainingSql} > 0`
  // The due date is a day in the company's zone, compared with the company's today.
  const overdue = sql`${open} AND ${financialRecords.dueAt} IS NOT NULL AND (${financialRecords.dueAt} AT TIME ZONE ${timeZone})::date < (now() AT TIME ZONE ${timeZone})::date`
  return {
    all: sql`true`,
    draft: isDraftSql,
    open,
    overdue,
    paid: sql`${live} AND ${remainingSql} = 0`,
    rejected: isRejected,
  }
}

function escapeLike(text: string) {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`)
}

export async function listRecordsPage(query: z.infer<typeof RecordsQuerySchema>) {
  const company = await getCompany()
  const tabs = tabConditions(company.timeZone)

  const filters: SQL[] = [isNull(financialRecords.deletedAt), ne(financialRecords.type, 'proforma')]
  if (query.direction) filters.push(eq(financialRecords.direction, query.direction))
  if (query.type) filters.push(eq(financialRecords.type, query.type))
  if (query.paymentStatus) filters.push(eq(financialRecords.paymentStatus, query.paymentStatus))
  if (query.anafStatus) filters.push(eq(financialRecords.anafStatus, query.anafStatus))
  if (query.from) filters.push(gte(financialRecords.issuedAt, query.from))
  if (query.to) filters.push(lte(financialRecords.issuedAt, query.to))
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`
    filters.push(
      sql`(${financialRecords.documentNumber} ILIKE ${pattern} OR ${financialRecords.counterpartyName} ILIKE ${pattern} OR ${financialRecords.counterpartyCif} ILIKE ${pattern} OR ${financialRecords.description} ILIKE ${pattern})`,
    )
  }

  // Only towards RON, the currency BNR quotes against; no stored rate gives null rather than the
  // 1:1 fallback the aggregates use, since a wrong figure under the amount is worse than none.
  const companyAmountSql =
    company.currency === 'RON'
      ? sql<number | null>`CASE WHEN ${financialRecords.currency} = 'RON' THEN NULL ELSE (${financialRecords.amount}::numeric * (
          SELECT er.rate::numeric FROM ${exchangeRates} er
          WHERE er.currency = ${qualified(financialRecords.currency)} AND er.deleted_at IS NULL
            AND er.date <= TO_CHAR((${qualified(financialRecords.issuedAt)}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')
          ORDER BY er.date DESC LIMIT 1
        ))::float8 END`.mapWith((v) => (v === null ? null : Number(v)))
      : sql<null>`NULL`

  const tab = query.tab ?? 'all'
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE
  const page = query.page ?? 1

  const countColumns = Object.fromEntries(
    RECORD_TABS.map((key) => [key, sql<number>`COUNT(*) FILTER (WHERE ${tabs[key]})`.mapWith(Number)]),
  ) as Record<RecordTab, SQL<number>>

  // Money is summed in the company's currency only, without drafts and rejected invoices, so total = paid + open.
  const counted = sql`${financialRecords.currency} = ${company.currency} AND NOT ${isDraftSql} AND NOT ${isRejected}`
  const money = (expression: SQL, when: SQL = counted) =>
    sql<number>`COALESCE(ROUND(SUM(${expression}) FILTER (WHERE ${when}), 2), 0)::float8`.mapWith(Number)

  const [[counts], [totals], [pageCount], rows] = await Promise.all([
    db.select(countColumns).from(financialRecords).where(and(...filters)),
    db
      .select({
        total: money(sql`${financialRecords.amount}`),
        paid: money(sql`${financialRecords.amount} - ${remainingSql}`),
        open: money(remainingSql),
        overdue: money(remainingSql, sql`${tabs.overdue} AND ${financialRecords.currency} = ${company.currency}`),
      })
      .from(financialRecords)
      .where(and(...filters)),
    db
      .select({ total: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(financialRecords)
      .where(and(...filters, tabs[tab])),
    db
      .select({
        ...recordColumns,
        paidAmount: sql<number>`${paidAmountSql}::float8`.mapWith(Number),
        remaining: sql<number>`${remainingSql}::float8`.mapWith(Number),
        isOverdue: sql<boolean>`COALESCE(${tabs.overdue}, false)`,
        isDraft: sql<boolean>`${isDraftSql}`,
        // The amount in the company's currency at the BNR rate of the document's day, under the
        // original amount; null when the document is already in that currency or it has no rate list.
        companyAmount: companyAmountSql,
      })
      .from(financialRecords)
      .where(and(...filters, tabs[tab]))
      .orderBy(desc(financialRecords.issuedAt), desc(financialRecords.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ])

  return {
    items: rows.map(toPublicRow),
    total: pageCount?.total ?? 0,
    totals: totals ?? { total: 0, paid: 0, open: 0, overdue: 0 },
    companyCurrency: company.currency,
    counts: counts ?? Object.fromEntries(RECORD_TABS.map((key) => [key, 0])),
  }
}
