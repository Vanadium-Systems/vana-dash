import cron from 'node-cron'
import { and, asc, eq, isNull, lte } from 'drizzle-orm'
import { getOutreachCapStatus, sendCampaignEmail } from '../modules/email/service.js'
import { getEmailSettings } from '../modules/email/settings-service.js'
import { getSuppressedEmails } from '../modules/email/unsubscribe-service.js'
import { db } from '../shared/db/client.js'
import { getCompanyTimeZone } from '../shared/lib/company.js'
import { emailSequenceEnrollments, emailSequences, emailSequenceSteps, syncLog } from '../shared/db/schema/index.js'

// Cron orar — la fiecare oră verifică dacă suntem în fereastra de trimitere configurată din
// Setări Email (oră + doar zile lucrătoare, implicit 10:00 L-V, în fusul firmei — serverul
// rulează în UTC, vezi isSendWindowNow). Avansează secvențele de follow-up automate (drip
// outreach) doar în fereastră. Pattern identic celorlalte cron-uri din jobs/: log în sync_log,
// failure izolat per enrollment, nu aruncă niciodată mai departe (regula #7 CLAUDE.md).

const CRON_EXPR = '0 * * * *' // în fiecare oră, la minutul 0 — gating pe fereastră e intern, nu în expresia cron
const MAX_CONSECUTIVE_FAILURES = 3

function isSendWindowNow(hour: number, weekdaysOnly: boolean, timeZone: string): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(new Date())
  const currentHour = Number(parts.find((p) => p.type === 'hour')!.value)
  const weekday = parts.find((p) => p.type === 'weekday')!.value
  if (currentHour !== hour) return false
  if (weekdaysOnly && (weekday === 'Sat' || weekday === 'Sun')) return false
  return true
}

export function startEmailSequenceRunnerJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void (async () => {
      const { outreachSendHour, outreachSendWeekdaysOnly } = await getEmailSettings()
      if (!isSendWindowNow(outreachSendHour, outreachSendWeekdaysOnly, await getCompanyTimeZone())) return
      await runEmailSequences()
    })().catch((err) => {
      console.error(`[email-sequence-runner] ${String(err)}`)
    })
  })
  console.log(`[email-sequence-runner] Scheduled (${CRON_EXPR}, fereastră de trimitere editabilă din Setări Email)`)
}

export async function runEmailSequences(): Promise<void> {
  const [log] = await db.insert(syncLog).values({ jobKey: 'email:sequence-runner', status: 'RUNNING' }).returning()
  try {
    const processed = await processDueEnrollments()
    if (log) {
      await db
        .update(syncLog)
        .set({ status: 'SUCCESS', recordsSync: processed, finishedAt: new Date() })
        .where(eq(syncLog.id, log.id))
    }
  } catch (err) {
    console.error(`[email-sequence-runner] eșuat: ${String(err)}`)
    if (log) {
      await db.update(syncLog).set({ status: 'FAILED', errorMessage: String(err), finishedAt: new Date() }).where(eq(syncLog.id, log.id))
    }
  }
}

type EnrollmentRow = typeof emailSequenceEnrollments.$inferSelect
type FromIdentity = 'stefan' | 'contact' | 'outreach'

async function processDueEnrollments(): Promise<number> {
  const rows = await db
    .select({ enrollment: emailSequenceEnrollments, fromIdentity: emailSequences.fromIdentity })
    .from(emailSequenceEnrollments)
    .innerJoin(emailSequences, eq(emailSequences.id, emailSequenceEnrollments.sequenceId))
    .where(
      and(
        isNull(emailSequenceEnrollments.deletedAt),
        eq(emailSequenceEnrollments.status, 'active'),
        lte(emailSequenceEnrollments.nextSendAt, new Date()),
        eq(emailSequences.active, true),
        isNull(emailSequences.deletedAt),
      ),
    )
    .orderBy(asc(emailSequenceEnrollments.nextSendAt))

  if (rows.length === 0) return 0

  // Cap-ul se verifică o singură dată per rulare (nu per enrollment) — secvențele pe
  // stefan/contact nu sunt plafonate, la fel ca bulk-ul ad-hoc de azi (vezi PLAN.md).
  let outreachRemaining = (await getOutreachCapStatus()).remaining
  const suppressed = await getSuppressedEmails(rows.map((r) => r.enrollment.recipientEmail))
  let processed = 0

  for (const { enrollment, fromIdentity } of rows) {
    if (fromIdentity === 'outreach' && outreachRemaining <= 0) continue // amânat, next_send_at neschimbat — reîncearcă mâine

    if (suppressed.has(enrollment.recipientEmail.trim().toLowerCase())) {
      await db
        .update(emailSequenceEnrollments)
        .set({ status: 'unsubscribed', updatedAt: new Date() })
        .where(eq(emailSequenceEnrollments.id, enrollment.id))
      continue
    }

    try {
      await advanceEnrollment(enrollment, fromIdentity as FromIdentity)
      if (fromIdentity === 'outreach') outreachRemaining--
      processed++
    } catch (err) {
      console.error(`[email-sequence-runner] enrollment ${enrollment.id} eșuat: ${String(err)}`)
    }
  }

  return processed
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

async function advanceEnrollment(enrollment: EnrollmentRow, fromIdentity: FromIdentity): Promise<void> {
  const nextStepOrder = enrollment.currentStep + 1
  const [step] = await db
    .select()
    .from(emailSequenceSteps)
    .where(and(eq(emailSequenceSteps.sequenceId, enrollment.sequenceId), eq(emailSequenceSteps.stepOrder, nextStepOrder)))
    .limit(1)

  if (!step) {
    // Fără pas următor (secvență goală/inconsistentă) — completed, nu retrimite la nesfârșit.
    await db
      .update(emailSequenceEnrollments)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(emailSequenceEnrollments.id, enrollment.id))
    return
  }

  const { result } = await sendCampaignEmail({
    to: enrollment.recipientEmail,
    nume: enrollment.recipientName ?? undefined,
    templateId: step.templateId,
    from: fromIdentity,
    sequenceEnrollmentId: enrollment.id,
  })

  if (!result.ok) {
    const consecutiveFailures = enrollment.consecutiveFailures + 1
    await db
      .update(emailSequenceEnrollments)
      .set({
        consecutiveFailures,
        // A 3-a eșec consecutiv → oprit (adresă probabil moartă, nu reîncearcă la nesfârșit).
        // Altfel rămâne 'active' cu next_send_at neschimbat — cron-ul de mâine reîncearcă.
        status: consecutiveFailures >= MAX_CONSECUTIVE_FAILURES ? 'failed' : 'active',
        updatedAt: new Date(),
      })
      .where(eq(emailSequenceEnrollments.id, enrollment.id))
    return
  }

  const [followingStep] = await db
    .select()
    .from(emailSequenceSteps)
    .where(and(eq(emailSequenceSteps.sequenceId, enrollment.sequenceId), eq(emailSequenceSteps.stepOrder, nextStepOrder + 1)))
    .limit(1)

  await db
    .update(emailSequenceEnrollments)
    .set({
      currentStep: nextStepOrder,
      consecutiveFailures: 0,
      lastSentAt: new Date(),
      status: followingStep ? 'active' : 'completed',
      nextSendAt: followingStep ? addDays(new Date(), followingStep.delayDays) : enrollment.nextSendAt,
      updatedAt: new Date(),
    })
    .where(eq(emailSequenceEnrollments.id, enrollment.id))
}
