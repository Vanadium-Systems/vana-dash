import cron from 'node-cron'
import { and, eq, isNull, lte } from 'drizzle-orm'
import { db } from '../shared/db/client.js'
import { assistantConversations, dashboardConfig, scheduledRuns, users } from '../shared/db/schema/index.js'
import { sendEmail } from '../shared/lib/email.js'
import { isStaleRun, nextRecurrenceRun } from '../shared/lib/schedule-recurrence.js'
import { notifyPush } from '../shared/lib/push.js'

// Executor pentru `scheduled_runs` (PLAN.md Contract B): reminder-e și rapoarte programate
// din chat. Un singur cron de „tick" la minut care scanează ce e due — fără cron dinamic
// per task. Pending-urile pierdute în downtime se recuperează la boot (rulează o dată),
// cele mai vechi de 7 zile se marchează failed, nu se livrează întârziate.

const CRON_EXPR = '* * * * *'
// Preview-ul push-ului la raportul programat — primele ~140 caractere din răspuns.
const REPORT_PREVIEW_CHARS = 140

export interface ScheduledRunRow {
  id: string
  ownerUserId: string | null
  kind: 'reminder' | 'report'
  runAt: Date
  text: string | null
  prompt: string | null
  linkTo: string | null
  recurrence: 'once' | 'daily' | 'weekly'
  weekday: number | null
  conversationId: string | null
}

async function isReminderEmailFallbackEnabled(): Promise<boolean> {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, 'reminder_email_fallback'))
  return row?.value === true
}

export async function executeReminder(run: ScheduledRunRow): Promise<void> {
  // Push-ul îl primește autorul task-ului, nu toți abonații (C2): un reminder programat de un
  // coleg nu trebuie să sune pe telefonul lui Stefan.
  void notifyPush(
    'calendarReminder',
    {
      title: run.text ?? 'Reminder',
      body: run.runAt.toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', dateStyle: 'short', timeStyle: 'short' }),
      url: '/calendar',
    },
    run.ownerUserId ? [run.ownerUserId] : undefined,
  )
  if (await isReminderEmailFallbackEnabled()) {
    // Plasă de rezervă opțională (Setări → Asistent) — push-ul rămâne canalul primar. Mergi
    // la autorul task-ului, nu la `ALERT_EMAIL_TO`: reminder-ul unui coleg nu e alertă de sistem.
    const [owner] = run.ownerUserId
      ? await db.select({ email: users.email }).from(users).where(eq(users.id, run.ownerUserId))
      : []
    if (owner) {
      await sendEmail({
        to: owner.email,
        subject: `[vana-dash] Reminder: ${run.text ?? ''}`,
        text: `Reminder programat în vana-dash: ${run.text ?? ''}`,
      })
    }
  }
}

export async function executeReport(run: ScheduledRunRow): Promise<string> {
  const { runConversationTurn } = await import('../modules/assistant/service.js')
  let conversationId = run.conversationId
  if (!conversationId) {
    // Conversația rămâne a autorului (C2): raportul rulează cu drepturile lui, iar rezultatul
    // îi apare în Asistentul lui, nu într-o conversație fără om.
    const [conversation] = await db
      .insert(assistantConversations)
      .values({ title: (run.prompt ?? 'Raport programat').slice(0, 60), ownerUserId: run.ownerUserId })
      .returning()
    conversationId = conversation!.id
  }

  let preview = ''
  let failure: string | null = null
  for await (const event of runConversationTurn(conversationId, run.prompt ?? '')) {
    if (event.type === 'text_delta' && preview.length < REPORT_PREVIEW_CHARS + 200) {
      preview += event.text
    }
    if (event.type === 'error') failure = event.message
  }
  // Eroarea (de exemplu plafonul atins) trebuie să ajungă în `last_error` al task-ului, nu să
  // treacă drept „raport gol" — altfel rândul pare livrat.
  if (failure && !preview) throw new Error(failure)
  return preview.slice(0, REPORT_PREVIEW_CHARS)
}

function reprogramRecurring(run: ScheduledRunRow): Date | null {
  if (run.recurrence === 'once') return null
  let next = nextRecurrenceRun(run.runAt, run.recurrence, run.weekday)
  const now = new Date()
  // Downtime lung — sare peste ocurențele pierdute până prima viitoare; o singură execuție.
  while (next.getTime() <= now.getTime()) {
    next = nextRecurrenceRun(next, run.recurrence, run.weekday)
  }
  return next
}

export async function runScheduledTick(now = new Date()): Promise<void> {
  const due = await db
    .select()
    .from(scheduledRuns)
    .where(and(isNull(scheduledRuns.deletedAt), eq(scheduledRuns.status, 'pending'), lte(scheduledRuns.runAt, now)))

  for (const row of due) {
    try {
      if (isStaleRun(row.runAt, now)) {
        await db
          .update(scheduledRuns)
          .set({ status: 'failed', lastError: 'Depășit (>7 zile) — nelivrât', updatedAt: new Date() })
          .where(eq(scheduledRuns.id, row.id))
        continue
      }

      let lastError: string | undefined
      try {
        if (row.kind === 'reminder') {
          await executeReminder(row)
        } else {
          await executeReport(row)
        }
      } catch (err) {
        lastError = String(err)
        console.error(`[scheduled-tick] ${row.kind} ${row.id} eșuat: ${lastError}`)
      }

      const nextAt = reprogramRecurring(row)
      if (nextAt) {
        // Recurentele nu se marchează done — își calculează următoarea rulare și rămân pending.
        await db
          .update(scheduledRuns)
          .set({ runAt: nextAt, lastError: lastError ?? null, updatedAt: new Date() })
          .where(eq(scheduledRuns.id, row.id))
      } else {
        await db
          .update(scheduledRuns)
          .set({ status: lastError ? 'failed' : 'done', lastError: lastError ?? null, updatedAt: new Date() })
          .where(eq(scheduledRuns.id, row.id))
      }
    } catch (err) {
      // Failure izolat per task (regula #7 CLAUDE.md) — un rând corupt nu blochează restul.
      console.error(`[scheduled-tick] rând ${row.id} eșuat: ${String(err)}`)
    }
  }
}

let ticking = false

export function startScheduledTickJob(): void {
  cron.schedule(CRON_EXPR, () => {
    if (ticking) return
    ticking = true
    void runScheduledTick()
      .catch((err) => console.error(`[scheduled-tick] ${String(err)}`))
      .finally(() => {
        ticking = false
      })
  })
  console.log(`[scheduled-tick] Scheduled (${CRON_EXPR})`)
  // Recuperare pending-uri pierdute în downtime — tick-ul de boot le execută exact o dată.
  void runScheduledTick().catch((err) => console.error(`[scheduled-tick] recuperare boot: ${String(err)}`))
}
