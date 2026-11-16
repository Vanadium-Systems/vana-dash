import { and, asc, eq, isNull, lte, ne, not } from 'drizzle-orm'
import { getCountryPack } from '../../countries/index.js'
import { db } from '../../shared/db/client.js'
import { declarationFilings, financialRecords } from '../../shared/db/schema/index.js'
import { ANAF_REFRESH_TOKEN_LIFETIME_DAYS } from '../../jobs/accounting-alerts.js'
import { getAnafCredentialsRow } from '../../shared/lib/anaf.js'
import { getCompany } from '../../shared/lib/company.js'
import { isDraftSql } from '../../shared/lib/payments.js'

const WINDOW_DAYS = 30
const MAX_ITEMS = 10
const DAY_MS = 24 * 60 * 60 * 1000

export interface Deadline {
  kind: 'invoice_due' | 'declaration' | 'anaf_token'
  title: string
  dueAt: string
  ref: { type: string; id: string } | null
  overdue: boolean
}

// Titles are data only; the frontend labels each row from `kind`. The declaration and ANAF rows
// are gated here by feature because they ride on the page-level `facturi.view` route.
export async function listDeadlines(features: string[], now = new Date()): Promise<Deadline[]> {
  const horizon = new Date(now.getTime() + WINDOW_DAYS * DAY_MS)
  const items: Deadline[] = []
  const push = (kind: Deadline['kind'], title: string, dueAt: Date, ref: Deadline['ref']) =>
    items.push({ kind, title, dueAt: dueAt.toISOString(), ref, overdue: dueAt.getTime() < now.getTime() })

  const invoices = await db
    .select({
      id: financialRecords.id,
      documentNumber: financialRecords.documentNumber,
      counterpartyName: financialRecords.counterpartyName,
      dueAt: financialRecords.dueAt,
    })
    .from(financialRecords)
    .where(
      and(
        isNull(financialRecords.deletedAt),
        eq(financialRecords.direction, 'out'),
        eq(financialRecords.type, 'invoice'),
        ne(financialRecords.paymentStatus, 'paid'),
        lte(financialRecords.dueAt, horizon),
        not(isDraftSql),
      ),
    )
    .orderBy(asc(financialRecords.dueAt))
    .limit(MAX_ITEMS)
  for (const inv of invoices) {
    if (!inv.dueAt) continue
    push('invoice_due', [inv.documentNumber, inv.counterpartyName].filter(Boolean).join(' · '), inv.dueAt, {
      type: 'invoice',
      id: inv.id,
    })
  }

  if (features.includes('facturi.declaratii')) {
    const company = await getCompany()
    const filed = await db
      .select({ code: declarationFilings.code, period: declarationFilings.period })
      .from(declarationFilings)
      .where(isNull(declarationFilings.deletedAt))
    const isFiled = (code: string, period: string) => filed.some((f) => f.code === code && f.period === period)
    for (const d of getCountryPack(company.country).declarationDeadlines(now)) {
      if (d.dueAt > horizon || isFiled(d.code, d.period)) continue
      push('declaration', `${d.code} ${d.period}`, d.dueAt, { type: 'declaration', id: `${d.code}:${d.period}` })
    }
  }

  if (features.includes('facturi.anaf')) {
    const creds = await getAnafCredentialsRow()
    if (creds?.status === 'active' && creds.lastRefreshedAt) {
      const expiresAt = new Date(creds.lastRefreshedAt.getTime() + ANAF_REFRESH_TOKEN_LIFETIME_DAYS * DAY_MS)
      if (expiresAt <= horizon) push('anaf_token', creds.cif, expiresAt, null)
    }
  }

  return items.sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, MAX_ITEMS)
}
