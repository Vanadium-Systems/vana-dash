import { z } from 'zod/v4'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '../../../shared/db/client.js'
import type { SessionUser } from '../../../shared/lib/session.js'
import { calendarEvents, scheduledRuns } from '../../../shared/db/schema/index.js'
import { autoTool, confirmTool, type ToolBuildContext } from './shared.js'

// Reminder-e și rapoarte programate din chat (PLAN.md Contract B). Calendarul rămâne sursa
// de adevăr pt. reminder-e (eveniment creat la execuție); push-ul la momentul T îl livrează
// jobs/scheduled-tick.ts prin scheduled_runs — evenimentul NU are reminderMinutesBefore,
// altfel calendar-reminders ar livra dublu.

const isoDatetime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Dată ISO invalidă' })

export function buildScheduledTools(ctx: ToolBuildContext) {
  return [
    confirmTool(ctx, {
      name: 'create_reminder',
      inputSchema: z.object({
        when: isoDatetime.describe('Momentul reminder-ului (ISO datetime)'),
        text: z.string().min(1).max(500).describe('Ce să-ți reamintească'),
        linkTo: z.string().max(200).optional().describe('Referință opțională la o entitate ([[type:id]])'),
      }),
      description: 'Creează un reminder cu notificare push la momentul cerut (+ eveniment în Calendar).',
      summarize: (a) => {
        const when = new Date(a.when).toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', dateStyle: 'medium', timeStyle: 'short' })
        return `Reminder „${a.text}" pe ${when}`
      },
    }),
    confirmTool(ctx, {
      name: 'schedule_report',
      inputSchema: z.object({
        when: isoDatetime.describe('Când rulezi raportul (ISO datetime)'),
        prompt: z.string().min(1).max(4000).describe('Promptul de rulat ca și cum l-ar trimite Stefan'),
        recurrence: z.enum(['once', 'daily', 'weekly']).default('once'),
        weekday: z.number().int().min(0).max(6).optional().describe('Doar weekly — ziua (0=duminică..6=sâmbătă)'),
      }),
      description: 'Programază rularea unui prompt de asistent la data/ora cerută; rezultatul ajunge prin push și în conversație.',
      summarize: (a) => {
        const when = new Date(a.when).toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest', dateStyle: 'medium', timeStyle: 'short' })
        const rec = a.recurrence === 'once' ? '' : `, repetând ${a.recurrence === 'daily' ? 'zilnic' : `săptămânal (${['duminică', 'luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă'][a.weekday ?? 0]})`}`
        return `Raport programat pe ${when}${rec}: „${a.prompt.slice(0, 80)}"`
      },
    }),
    confirmTool(ctx, {
      name: 'cancel_scheduled_run',
      inputSchema: z.object({ id: z.string().describe('Id-ul task-ului programat') }),
      description: 'Anulează un reminder sau raport programat.',
      summarize: (a) => `Anulare task programat ${a.id}`,
    }),
    autoTool({
      name: 'list_scheduled_runs',
      inputSchema: z.object({}),
      description: 'Listă task-uri programate active (reminder-e și rapoarte), cu id pt. anulare.',
      run: () => listScheduledRuns(ctx.user),
    }),
  ]
}

export async function createReminder(me: SessionUser, input: { when: string; text: string; linkTo?: string }) {
  const runAt = new Date(input.when)
  // Evenimentul calendar e sursa de adevăr — fără reminderMinutesBefore, push-ul vine din tick.
  const [event] = await db
    .insert(calendarEvents)
    .values({ ownerUserId: me.id, title: input.text, startAt: runAt, endAt: runAt })
    .returning()
  const [run] = await db
    .insert(scheduledRuns)
    .values({ ownerUserId: me.id, kind: 'reminder', runAt, text: input.text, linkTo: input.linkTo ?? null, recurrence: 'once' })
    .returning()
  return { runId: run!.id, eventId: event!.id }
}

export async function scheduleReport(
  me: SessionUser,
  conversationId: string | null,
  input: { when: string; prompt: string; recurrence?: 'once' | 'daily' | 'weekly'; weekday?: number },
) {
  // Weekly fără ziua explicită = ziua datei de start — predictibil, nu ales arbitrar.
  const weekday = input.recurrence === 'weekly' ? ((input.weekday ?? new Date(input.when).getUTCDay()) as number) : null
  const [run] = await db
    .insert(scheduledRuns)
    .values({
      ownerUserId: me.id,
      kind: 'report',
      runAt: new Date(input.when),
      prompt: input.prompt,
      recurrence: input.recurrence ?? 'once',
      weekday,
      conversationId,
    })
    .returning()
  return { runId: run!.id }
}

export async function cancelScheduledRun(me: SessionUser, id: string) {
  const [row] = await db
    .update(scheduledRuns)
    .set({ status: 'cancelled', updatedAt: new Date() })
    .where(and(eq(scheduledRuns.id, id), eq(scheduledRuns.status, 'pending'), eq(scheduledRuns.ownerUserId, me.id)))
    .returning()
  if (!row) throw new Error('Task inexistent sau nu mai e pending')
  return { cancelled: row.id }
}

export async function listScheduledRuns(me: SessionUser) {
  return db
    .select()
    .from(scheduledRuns)
    .where(and(eq(scheduledRuns.status, 'pending'), eq(scheduledRuns.ownerUserId, me.id)))
    .orderBy(desc(scheduledRuns.runAt))
    .limit(50)
}

// Executorii reali — apelați din POST /api/assistant/actions/:id/confirm. schedule_report
// primește conversația curentă prin al doilea argument, injectat de service.confirmPendingAction.
export const scheduledConfirmExecutors: Record<
  string,
  (input: never, ctx: { conversationId: string; user: SessionUser }) => Promise<unknown>
> = {
  create_reminder: (input: { when: string; text: string; linkTo?: string }, ctx) => createReminder(ctx.user, input),
  schedule_report: (
    input: { when: string; prompt: string; recurrence?: 'once' | 'daily' | 'weekly'; weekday?: number },
    ctx,
  ) => scheduleReport(ctx.user, ctx.conversationId, input),
  cancel_scheduled_run: (input: { id: string }, ctx) => cancelScheduledRun(ctx.user, input.id),
}
