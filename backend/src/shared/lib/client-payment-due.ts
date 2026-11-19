import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { financialRecords } from '../db/schema/index.js'
import { getCompanyTimeZone } from './company.js'
import { dayInTimeZone, remainingSql } from './payments.js'

// billing_clients.billing_due_date is the day the next invoice is issued, and the daily rollover
// moves it on whether or not the last invoice was paid. Counting down to it, the VanaGreen billing
// banner and the client reminders never showed an unpaid invoice. They count down to this instead.

/** Due day of the client's oldest issued invoice with something left to pay, or null. */
export async function oldestUnpaidDueDate(billingClientId: string): Promise<string | null> {
  const [row] = await db
    .select({ dueAt: financialRecords.dueAt })
    .from(financialRecords)
    .where(
      and(
        eq(financialRecords.billingClientId, billingClientId),
        isNull(financialRecords.deletedAt),
        eq(financialRecords.direction, 'out'),
        eq(financialRecords.type, 'invoice'),
        isNotNull(financialRecords.documentNumber),
        // A storno is not owed, and an invoice fully reversed by stornos has nothing left to collect.
        isNull(financialRecords.correctsRecordId),
        isNotNull(financialRecords.dueAt),
        sql`${remainingSql} > 0`,
      ),
    )
    .orderBy(asc(financialRecords.dueAt))
    .limit(1)
  if (!row?.dueAt) return null
  return dayInTimeZone(row.dueAt, await getCompanyTimeZone())
}

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10)
}

/**
 * The day the client has to have paid by: the oldest unpaid invoice's due day, or, with nothing
 * owed, the next invoice day plus the payment terms.
 */
export async function clientPaymentDueDate(client: {
  id: string
  billingDueDate: string | null
  paymentTermsDays: number | null
}): Promise<string | null> {
  const unpaid = await oldestUnpaidDueDate(client.id)
  if (unpaid) return unpaid
  if (!client.billingDueDate) return null
  return addDays(client.billingDueDate, client.paymentTermsDays ?? 0)
}
