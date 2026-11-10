import { activeAdminIds } from '../shared/lib/notify.js'
import { createHash } from 'node:crypto'
import cron from 'node-cron'
import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { getOutreachCapStatus, sendCampaignEmail } from '../modules/email/service.js'
import {
  emailBlockedReason,
  isPlaceholderRecipient,
  stopEnrollmentsForProspect,
} from '../modules/email/sequences-service.js'
import { getEmailSettings } from '../modules/email/settings-service.js'
import { getSuppressedEmails } from '../modules/email/unsubscribe-service.js'
import { db } from '../shared/db/client.js'
import { getCompanyTimeZone } from '../shared/lib/company.js'
import { onProspectEvent } from '../shared/lib/prospect-events.js'
import {
  emailSequenceEnrollments,
  emailSequences,
  emailSequenceSteps,
  emailSuppressions,
  prospects,
  prospectTasks,
  syncLog,
} from '../shared/db/schema/index.js'

// Cron orar — la fiecare oră verifică dacă suntem în fereastra de trimitere configurată din
// Setări Email (oră + doar zile lucrătoare, implicit 10:00 L-V, în fusul firmei — serverul
// rulează în UTC, vezi isSendWindowNow). Avansează secvențele de follow-up automate (drip
// outreach) doar în fereastră. Pattern identic celorlalte cron-uri din jobs/: log în sync_log,
// failure izolat per enrollment, nu aruncă niciodată mai departe (regula #7 CLAUDE.md).

const CRON_EXPR = '0 * * * *' // în fiecare oră, la minutul 0 — gating pe fereastră e intern, nu în expresia cron
const MAX_CONSECUTIVE_FAILURES = 3
// A call or task nobody touched for this long is skipped and the sequence moves on.
const TASK_PATIENCE_DAYS = 7

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
  registerSequenceListeners()
  cron.schedule(CRON_EXPR, () => {
    void (async () => {
      const { outreachSendHour, outreachSendWeekdaysOnly } = await getEmailSettings()
      // Only email steps wait for the send window; a call or task step is created whenever it falls due.
      const inWindow = isSendWindowNow(outreachSendHour, outreachSendWeekdaysOnly, await getCompanyTimeZone())
      await runEmailSequences({ inWindow })
    })().catch((err) => {
      console.error(`[email-sequence-runner] ${String(err)}`)
    })
  })
  console.log(`[email-sequence-runner] Scheduled (${CRON_EXPR}, fereastră de trimitere editabilă din Setări Email)`)
}

/** A/B choice for one enrollment at one step: stable across retries, about half and half overall. */
export function pickVariant(enrollmentId: string, stepId: string): 'A' | 'B' {
  return createHash('sha256').update(`${enrollmentId}${stepId}`).digest()[0]! % 2 === 0 ? 'A' : 'B'
}

let listenersRegistered = false

/** Task done releases a waiting enrollment; a won/lost stage or a booked meeting stops it. Once per process. */
export function registerSequenceListeners(): void {
  if (listenersRegistered) return
  listenersRegistered = true
  onProspectEvent('task.done', ({ taskId }) => releaseEnrollmentsWaitingFor(taskId))
  onProspectEvent('prospect.stage_changed', ({ prospectId, kind }) => {
    if (kind === 'won' || kind === 'lost') return stopEnrollmentsForProspect(prospectId, 'won_lost')
  })
  onProspectEvent('meeting.booked', ({ prospectId }) => stopEnrollmentsForProspect(prospectId, 'meeting'))
}

export async function runEmailSequences(options: { inWindow?: boolean } = {}): Promise<void> {
  const [log] = await db.insert(syncLog).values({ jobKey: 'email:sequence-runner', status: 'RUNNING' }).returning()
  try {
    const processed = await processDueEnrollments(options.inWindow ?? true)
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

interface SendGate {
  inWindow: boolean
  outreachRemaining: number
}

async function processDueEnrollments(inWindow: boolean): Promise<number> {
  // Stop every suppressed address now, not only when its next step is due: otherwise a bounced
  // or unsubscribed recipient keeps showing as active in the enrollments list until then.
  await db
    .update(emailSequenceEnrollments)
    .set({
      status: sql`CASE WHEN (SELECT s."source" FROM ${emailSuppressions} s WHERE s."email" = lower(trim(${emailSequenceEnrollments.recipientEmail}))) = 'bounce' THEN 'bounced' ELSE 'unsubscribed' END`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(emailSequenceEnrollments.status, 'active'),
        isNull(emailSequenceEnrollments.deletedAt),
        sql`exists (select 1 from ${emailSuppressions} where ${emailSuppressions.email} = lower(trim(${emailSequenceEnrollments.recipientEmail})))`,
      ),
    )

  await releaseClosedTasks()

  const rows = await db
    .select({ enrollment: emailSequenceEnrollments, fromIdentity: emailSequences.fromIdentity })
    .from(emailSequenceEnrollments)
    .innerJoin(emailSequences, eq(emailSequences.id, emailSequenceEnrollments.sequenceId))
    .where(
      and(
        isNull(emailSequenceEnrollments.deletedAt),
        eq(emailSequenceEnrollments.status, 'active'),
        isNull(emailSequenceEnrollments.waitingTaskId),
        lte(emailSequenceEnrollments.nextSendAt, new Date()),
        eq(emailSequences.active, true),
        isNull(emailSequences.pausedAt),
        isNull(emailSequences.deletedAt),
      ),
    )
    .orderBy(asc(emailSequenceEnrollments.nextSendAt))

  if (rows.length === 0) return 0

  // Cap-ul se verifică o singură dată per rulare (nu per enrollment) — secvențele pe
  // stefan/contact nu sunt plafonate, la fel ca bulk-ul ad-hoc de azi (vezi PLAN.md).
  const gate: SendGate = { inWindow, outreachRemaining: (await getOutreachCapStatus()).remaining }
  const suppressed = await getSuppressedEmails(rows.map((r) => r.enrollment.recipientEmail))
  let processed = 0

  for (const { enrollment, fromIdentity } of rows) {
    if (suppressed.has(enrollment.recipientEmail.trim().toLowerCase())) {
      await db
        .update(emailSequenceEnrollments)
        .set({ status: 'unsubscribed', updatedAt: new Date() })
        .where(eq(emailSequenceEnrollments.id, enrollment.id))
      continue
    }

    try {
      if (await advanceEnrollment(enrollment, fromIdentity as FromIdentity, gate)) processed++
    } catch (err) {
      console.error(`[email-sequence-runner] enrollment ${enrollment.id} eșuat: ${String(err)}`)
    }
  }

  return processed
}

/**
 * Enrollments waiting on a task that is closed (done, skipped, deleted) move on. A task open for
 * more than TASK_PATIENCE_DAYS is skipped first. The `task.done` listener is the fast path; this
 * also catches a done event lost to a restart.
 */
async function releaseClosedTasks(): Promise<void> {
  const waiting = and(
    eq(emailSequenceEnrollments.status, 'active'),
    isNull(emailSequenceEnrollments.deletedAt),
    isNotNull(emailSequenceEnrollments.waitingTaskId),
    eq(emailSequences.active, true),
    isNull(emailSequences.pausedAt),
    isNull(emailSequences.deletedAt),
  )
  const now = new Date()
  const patienceEnd = new Date(now.getTime() - TASK_PATIENCE_DAYS * 24 * 60 * 60 * 1000)

  const stale = await db
    .select({ taskId: prospectTasks.id })
    .from(emailSequenceEnrollments)
    .innerJoin(emailSequences, eq(emailSequences.id, emailSequenceEnrollments.sequenceId))
    .innerJoin(prospectTasks, eq(prospectTasks.id, emailSequenceEnrollments.waitingTaskId))
    .where(and(waiting, isNull(prospectTasks.doneAt), isNull(prospectTasks.skippedAt), isNull(prospectTasks.deletedAt), lt(prospectTasks.createdAt, patienceEnd)))
  if (stale.length > 0) {
    await db
      .update(prospectTasks)
      .set({ skippedAt: now, updatedAt: now })
      .where(inArray(prospectTasks.id, stale.map((r) => r.taskId)))
  }

  const closed = await db
    .select({ enrollment: emailSequenceEnrollments })
    .from(emailSequenceEnrollments)
    .innerJoin(emailSequences, eq(emailSequences.id, emailSequenceEnrollments.sequenceId))
    .innerJoin(prospectTasks, eq(prospectTasks.id, emailSequenceEnrollments.waitingTaskId))
    .where(and(waiting, or(isNotNull(prospectTasks.doneAt), isNotNull(prospectTasks.skippedAt), isNotNull(prospectTasks.deletedAt))))
  for (const { enrollment } of closed) await releaseEnrollment(enrollment)
}

export async function releaseEnrollmentsWaitingFor(taskId: string): Promise<void> {
  const waiting = await db
    .select()
    .from(emailSequenceEnrollments)
    .where(and(eq(emailSequenceEnrollments.waitingTaskId, taskId), eq(emailSequenceEnrollments.status, 'active'), isNull(emailSequenceEnrollments.deletedAt)))
  for (const enrollment of waiting) await releaseEnrollment(enrollment)
}

/** `current_step` is the task's step: the next one is due its delay after now, or the sequence is over. */
async function releaseEnrollment(enrollment: EnrollmentRow): Promise<void> {
  const following = await stepAt(enrollment.sequenceId, enrollment.currentStep + 1)
  await db
    .update(emailSequenceEnrollments)
    .set({
      waitingTaskId: null,
      status: following ? 'active' : 'completed',
      nextSendAt: following ? addDays(new Date(), following.delayDays) : enrollment.nextSendAt,
      updatedAt: new Date(),
    })
    .where(and(eq(emailSequenceEnrollments.id, enrollment.id), eq(emailSequenceEnrollments.waitingTaskId, enrollment.waitingTaskId!)))
}

async function stepAt(sequenceId: string, stepOrder: number) {
  const [step] = await db
    .select()
    .from(emailSequenceSteps)
    .where(and(eq(emailSequenceSteps.sequenceId, sequenceId), eq(emailSequenceSteps.stepOrder, stepOrder), isNull(emailSequenceSteps.deletedAt)))
    .limit(1)
  return step
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function fillStepText(text: string, vars: { firma: string; nume: string }): string {
  return text.replaceAll('{{firma}}', vars.firma).replaceAll('{{nume}}', vars.nume)
}

/** The prospect's owner, else the first active admin: a task nobody owns is a task nobody sees. */
async function taskAssignee(ownerUserId: string | null): Promise<string> {
  if (ownerUserId) return ownerUserId
  const [adminId] = await activeAdminIds()
  if (!adminId) throw new Error('no active admin to assign the sequence task to')
  return adminId
}

/** True when it did something this run (sent an email, made a task, closed or skipped a step). */
async function advanceEnrollment(enrollment: EnrollmentRow, fromIdentity: FromIdentity, gate: SendGate): Promise<boolean> {
  const nextStepOrder = enrollment.currentStep + 1
  const step = await stepAt(enrollment.sequenceId, nextStepOrder)

  if (!step) {
    // Fără pas următor (secvență goală/inconsistentă) — completed, nu retrimite la nesfârșit.
    await db
      .update(emailSequenceEnrollments)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(emailSequenceEnrollments.id, enrollment.id))
    return true
  }

  const following = await stepAt(enrollment.sequenceId, nextStepOrder + 1)
  // The step is done (sent or skipped): the next one is due its delay from now, or the sequence ends.
  const moveOn = (extra: Partial<typeof emailSequenceEnrollments.$inferInsert> = {}) =>
    db
      .update(emailSequenceEnrollments)
      .set({
        currentStep: nextStepOrder,
        status: following ? 'active' : 'completed',
        nextSendAt: following ? addDays(new Date(), following.delayDays) : enrollment.nextSendAt,
        updatedAt: new Date(),
        ...extra,
      })
      .where(eq(emailSequenceEnrollments.id, enrollment.id))

  if (step.kind !== 'email') {
    const [prospect] = enrollment.prospectId
      ? await db.select({ id: prospects.id, name: prospects.name, assignedUserId: prospects.assignedUserId }).from(prospects).where(and(eq(prospects.id, enrollment.prospectId), isNull(prospects.deletedAt)))
      : []
    if (!prospect) {
      // A free address has no prospect to hang a task on: the step is skipped, the sequence goes on.
      await moveOn()
      return true
    }
    const vars = { firma: prospect.name, nume: enrollment.recipientName ?? '' }
    const assigneeUserId = await taskAssignee(prospect.assignedUserId)
    await db.transaction(async (tx) => {
      const [task] = await tx
        .insert(prospectTasks)
        .values({
          prospectId: prospect.id,
          assigneeUserId,
          kind: step.kind as (typeof prospectTasks.$inferInsert)['kind'],
          title: fillStepText(step.taskTitle ?? '', vars),
          description: step.taskDescription ? fillStepText(step.taskDescription, vars) : null,
          dueAt: new Date(),
        })
        .returning({ id: prospectTasks.id })
      // current_step moves now; last_sent_at stays, nothing was sent.
      await tx
        .update(emailSequenceEnrollments)
        .set({ currentStep: nextStepOrder, waitingTaskId: task!.id, updatedAt: new Date() })
        .where(eq(emailSequenceEnrollments.id, enrollment.id))
    })
    return true
  }

  // Email step: window and outreach cap apply here only. Deferred rows keep next_send_at and retry next run.
  if (!gate.inWindow) return false
  if (fromIdentity === 'outreach' && gate.outreachRemaining <= 0) return false

  // A placeholder address (prospect with no email at enrollment) is never mailed.
  if (isPlaceholderRecipient(enrollment.recipientEmail)) {
    await moveOn()
    return true
  }
  if (enrollment.prospectId) {
    const blocked = await emailBlockedReason(enrollment.prospectId, enrollment.recipientEmail)
    if (blocked) {
      const status = blocked === 'BOUNCED' ? 'bounced' : blocked === 'NO_EMAIL' ? 'failed' : 'unsubscribed'
      await db.update(emailSequenceEnrollments).set({ status, updatedAt: new Date() }).where(eq(emailSequenceEnrollments.id, enrollment.id))
      return true
    }
  }

  const variant = pickVariant(enrollment.id, step.id)
  const { result } = await sendCampaignEmail({
    to: enrollment.recipientEmail,
    nume: enrollment.recipientName ?? undefined,
    templateId: (variant === 'B' && step.variantBTemplateId ? step.variantBTemplateId : step.templateId)!,
    from: fromIdentity,
    sequenceEnrollmentId: enrollment.id,
    sequenceStepId: step.id,
    variant,
  })
  if (fromIdentity === 'outreach') gate.outreachRemaining--

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
    return true
  }

  await moveOn({ consecutiveFailures: 0, lastSentAt: new Date() })
  return true
}
