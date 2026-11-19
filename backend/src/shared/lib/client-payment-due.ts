import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { financialRecords } from '../db/schema/index.js'
import { getCompanyTimeZone } from './company.js'
import { dayInTimeZone, remainingSql } from './payments.js'

// billing_clients.billing_due_date is the day the next invoice is issued, and the daily rollover
// moves it on whether or not the last invoice was paid. Counting down to it, the VanaGreen billing
// banner and the client reminders never showed an unpaid invoice (614e507f). They count down to the
// oldest unpaid invoice instead; the VanaGreen document is built in connectors/vanagreen/billing-state.ts.

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
