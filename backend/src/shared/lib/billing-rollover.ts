import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { billingClients } from '../db/schema/index.js'
import { pushBillingCycleIfMapped } from '../../modules/reconciliation/vanagreen-extension.js'
import { computeNextOccurrence, dayAfter, type BillingCycle } from './billing-cycle.js'

// Rostogolire billingDueDate la o PLATĂ confirmată — folosit de ambele căi prin care o factură
// poate deveni 'paid' (modules/accounting/service.ts updatePayment — marcare manuală, ȘI
// shared/lib/bank-sync.ts — auto-match bancar). Bug real (Stefan, 2026-08-01): fără asta,
// "Scadență curentă" rămânea pe data facturii deja emise ȘI plătite până a doua zi — singurul
// loc care rostogolea era jobs/billing-cycle-rollover.ts, care rulează o dată/zi și rostogolește
// DOAR când daysUntilDue < 0 (ziua DUPĂ scadență, intenționat — ca vanagreen-billing.ts să mai
// apuce să emită factura zilei). O plată confirmată e un semnal mai devreme și mai sigur decât
// "a trecut o zi" — dacă factura e pt. ciclul curent-sau-mai-vechi, rostogolim imediat.
export async function rollBillingDueDateOnPayment(billingClientId: string, invoiceIssuedAt: Date): Promise<void> {
  const [client] = await db
    .select()
    .from(billingClients)
    .where(and(eq(billingClients.id, billingClientId), isNull(billingClients.deletedAt)))
  if (!client || !client.billingCycle || client.billingCycleDay === null || !client.billingDueDate) return

  const invoiceIssuedAtIso = invoiceIssuedAt.toISOString().slice(0, 10)
  // Factura plătită trebuie să fie pt. ciclul curent-sau-mai-vechi — dacă billingDueDate e deja
  // ÎN VIITOR față de factura asta (ex. un istoric vechi marcat plătit acum), ciclul deja a
  // rulat mai departe, nu mai rostogolim încă o dată peste el.
  if (client.billingDueDate > invoiceIssuedAtIso) return

  const nextDueDate = computeNextOccurrence(
    { cycle: client.billingCycle as BillingCycle, day: client.billingCycleDay, month: client.billingCycleMonth },
    dayAfter(client.billingDueDate),
  )

  const [updated] = await db
    .update(billingClients)
    .set({
      billingDueDate: nextDueDate,
      billingReminder7dSentAt: null,
      billingReminder1dSentAt: null,
      billingOverdueSentAt: null,
      updatedAt: new Date(),
    })
    .where(eq(billingClients.id, client.id))
    .returning()

  if (updated) void pushBillingCycleIfMapped(updated)
}
