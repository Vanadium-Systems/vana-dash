import cron from 'node-cron'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { computeNextOccurrence, dayAfter, type BillingCycle } from '../shared/lib/billing-cycle.js'
import { db } from '../shared/db/client.js'
import { billingClients } from '../shared/db/schema/index.js'
import { sendEmail } from '../shared/lib/email.js'
import { pushBillingCycleIfMapped } from '../modules/reconciliation/vanagreen-extension.js'

// Sprint C, Track D: port din vanagreen (billing-cron.ts), mutat integral aici — vana-dash
// devine proprietarul complet al cadenței de facturare recurente + remindere client. Vanagreen
// renunță la propriul billing-cron.ts/billing-cycle.ts (wave 6, gated).
//
// Rulează zilnic la 08:00 UTC (aceeași oră ca vechiul cron din vanagreen, ca remindere să
// ajungă tot dimineața). Pentru fiecare billing_client cu billingDueDate setat:
//   1. Dacă are billingCycle și data a expirat (daysUntilDue < 0) → rostogolește la următoarea
//      apariție, resetează timestamp-urile de reminder, SARE peste trimiterea de azi (data
//      tocmai s-a schimbat sub el).
//   2. Altfel, planifică cel mult UN reminder per rulare (overdue > 1zi > 7zile, primul care se
//      potrivește), gardat de coloana *_sent_at aferentă — trimis o singură dată per scadență.
const CRON_EXPR = '0 8 * * *'

function todayUtcMidnight(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function parseIsoDateUtc(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
}

export function startBillingCycleRolloverJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runBillingCycleRolloverJob()
  })
  console.log(`[billing-cycle-rollover] Scheduled (${CRON_EXPR})`)
}

type Client = typeof billingClients.$inferSelect

async function rollOverIfLapsed(client: Client, daysUntilDue: number): Promise<boolean> {
  if (!client.billingCycle || client.billingCycleDay === null || daysUntilDue >= 0) return false

  const nextDue = computeNextOccurrence(
    { cycle: client.billingCycle as BillingCycle, day: client.billingCycleDay, month: client.billingCycleMonth },
    dayAfter(client.billingDueDate as string),
  )

  const [updated] = await db
    .update(billingClients)
    .set({
      billingDueDate: nextDue,
      billingReminder7dSentAt: null,
      billingReminder1dSentAt: null,
      billingOverdueSentAt: null,
      updatedAt: new Date(),
    })
    .where(eq(billingClients.id, client.id))
    .returning()

  console.log(`[billing-cycle-rollover] ${client.id}: ${client.billingDueDate} → ${nextDue}`)

  // Fire-and-forget izolat — oglindește noua dată pe vanagreen (BillingBanner tenant-facing).
  if (updated) void pushBillingCycleIfMapped(updated)

  return true
}

type ReminderType = 'reminder_7d' | 'reminder_1d' | 'overdue'
interface PlannedSend {
  type: ReminderType
  column: 'billingReminder7dSentAt' | 'billingReminder1dSentAt' | 'billingOverdueSentAt'
}

function planSend(client: Client, daysUntilDue: number): PlannedSend | null {
  if (daysUntilDue <= 0 && client.billingOverdueSentAt === null) return { type: 'overdue', column: 'billingOverdueSentAt' }
  if (daysUntilDue === 1 && client.billingReminder1dSentAt === null) return { type: 'reminder_1d', column: 'billingReminder1dSentAt' }
  if (daysUntilDue === 7 && client.billingReminder7dSentAt === null) return { type: 'reminder_7d', column: 'billingReminder7dSentAt' }
  return null
}

const SUBJECTS: Record<ReminderType, (name: string) => string> = {
  overdue: (name) => `${name} — factură restantă`,
  reminder_1d: (name) => `${name} — scadență mâine`,
  reminder_7d: (name) => `${name} — scadență în 7 zile`,
}

function buildText(type: ReminderType, clientName: string, dueDate: string): string {
  if (type === 'overdue') {
    return `Bună,\n\nAbonamentul ${clientName} are o plată restantă (scadentă la ${dueDate}).\n\nAcesta este un mesaj automat.`
  }
  const when = type === 'reminder_1d' ? 'mâine' : 'în 7 zile'
  return `Bună,\n\nAbonamentul ${clientName} are scadența ${when} (${dueDate}).\n\nAcesta este un mesaj automat.`
}

export async function runBillingCycleRolloverJob(): Promise<void> {
  const today = todayUtcMidnight()
  const clients = await db
    .select()
    .from(billingClients)
    .where(
      and(isNull(billingClients.deletedAt), isNotNull(billingClients.billingDueDate), eq(billingClients.isDemo, false)),
    )

  for (const client of clients) {
    const dueDate = client.billingDueDate as string
    const due = parseIsoDateUtc(dueDate)
    if (!due) {
      console.warn(`[billing-cycle-rollover] billingDueDate invalid pt. clientul ${client.id}: ${dueDate}`)
      continue
    }
    const daysUntilDue = Math.round((due.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))

    try {
      if (await rollOverIfLapsed(client, daysUntilDue)) continue
    } catch (err) {
      console.error(`[billing-cycle-rollover] rostogolire eșuată pt. clientul ${client.id}:`, err)
      continue
    }

    const plan = planSend(client, daysUntilDue)
    if (!plan) continue

    if (!client.email) {
      console.warn(`[billing-cycle-rollover] clientul ${client.id} nu are email — sar peste reminder`)
      continue
    }

    try {
      await sendEmail({
        to: client.email,
        subject: SUBJECTS[plan.type](client.name),
        text: buildText(plan.type, client.name, dueDate),
      })
      await db
        .update(billingClients)
        .set({ [plan.column]: new Date(), updatedAt: new Date() })
        .where(eq(billingClients.id, client.id))
      console.log(`[billing-cycle-rollover] reminder ${plan.type} trimis pt. clientul ${client.id}`)
    } catch (err) {
      console.error(`[billing-cycle-rollover] trimitere reminder eșuată pt. clientul ${client.id}:`, err)
    }
  }
}
