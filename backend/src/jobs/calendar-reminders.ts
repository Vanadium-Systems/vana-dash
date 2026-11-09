import cron from 'node-cron'
import { and, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm'
import { db } from '../shared/db/client.js'
import { calendarEventAttendees, calendarEventReminders, calendarEvents } from '../shared/db/schema/index.js'
import { notifyPush } from '../shared/lib/push.js'
import { expandOccurrence, loadExceptions } from '../shared/lib/calendar-occurrences.js'
import { getCompanyTimeZone } from '../shared/lib/company.js'
import { trFor } from '../shared/lib/i18n.js'
import { INTL_TAG } from '../shared/lib/locale.js'

// Reminder-uri push pt. evenimente de calendar (PLAN.md Sprint 2). Rulează la 5 minute —
// suficient de des ca un reminder de 5 min să nu rateze fereastra. Dedup pe ocurență
// (last_sent_occurrence, per rând de reminder, ține cheia ULTIMEI ocurențe notificate, nu un boolean) — un
// eveniment recurent trebuie să notifice la FIECARE apariție, nu o singură dată vreodată.

const CRON_EXPR = '*/5 * * * *'
// Same cap as the CHECK on calendar_event_reminders.minutes_before (4 weeks).
const MAX_LOOKAHEAD_MINUTES = 40320

export function startCalendarRemindersJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runCalendarReminders().catch((err) => console.error(`[calendar-reminders] ${String(err)}`))
  })
  console.log(`[calendar-reminders] Scheduled (${CRON_EXPR})`)
}

export async function runCalendarReminders(): Promise<void> {
  const timeZone = await getCompanyTimeZone()
  const now = new Date()

  const reminders = await db
    .select({
      id: calendarEventReminders.id,
      eventId: calendarEventReminders.eventId,
      minutesBefore: calendarEventReminders.minutesBefore,
      lastSentOccurrence: calendarEventReminders.lastSentOccurrence,
    })
    .from(calendarEventReminders)
    .innerJoin(calendarEvents, eq(calendarEvents.id, calendarEventReminders.eventId))
    .where(and(isNull(calendarEventReminders.deletedAt), isNull(calendarEvents.deletedAt)))
  if (reminders.length === 0) return

  const lookaheadMinutes = Math.min(MAX_LOOKAHEAD_MINUTES, Math.max(...reminders.map((r) => r.minutesBefore)))
  const windowEnd = new Date(now.getTime() + lookaheadMinutes * 60_000)

  const remindersByEvent = new Map<string, typeof reminders>()
  for (const reminder of reminders) {
    const list = remindersByEvent.get(reminder.eventId) ?? []
    list.push(reminder)
    remindersByEvent.set(reminder.eventId, list)
  }

  // Only events that can have an occurrence in [now, windowEnd]. A recurring event whose first
  // start is later than windowEnd has nothing yet; a moved occurrence of a series is still
  // covered because the series itself passes this filter.
  const rows = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        inArray(calendarEvents.id, [...remindersByEvent.keys()]),
        isNull(calendarEvents.deletedAt),
        or(
          and(isNull(calendarEvents.recurrenceRule), gte(calendarEvents.startAt, now), lte(calendarEvents.startAt, windowEnd)),
          and(
            lte(calendarEvents.startAt, windowEnd),
            or(isNull(calendarEvents.recurrenceEndAt), gte(calendarEvents.recurrenceEndAt, now)),
          ),
        ),
      ),
    )

  const exceptions = await loadExceptions(rows.filter((row) => row.recurrenceRule).map((row) => row.id))

  for (const row of rows) {
    // Failure izolat per eveniment (regula #7 CLAUDE.md) — un RRULE malformat nu blochează
    // restul reminder-elor.
    try {
      // Destinatarii: proprietarul evenimentului și — la un eveniment comun — participanții.
      // Nu tuturor: un calendar per om înseamnă că un reminder trimis „la toți" ar apărea în
      // bara de notificări a unui om care n-are evenimentul.
      const attendees = await db
        .select({ userId: calendarEventAttendees.userId })
        .from(calendarEventAttendees)
        .where(and(eq(calendarEventAttendees.eventId, row.id), isNull(calendarEventAttendees.deletedAt)))
      const recipients = attendees.length > 0 ? [row.ownerUserId, ...attendees.map((a) => a.userId)] : [row.ownerUserId]
      const occurrences = expandOccurrence(row, now, windowEnd, timeZone, exceptions)
      for (const reminder of remindersByEvent.get(row.id) ?? []) {
        for (const occ of occurrences) {
          const startAt = new Date(occ.occurrenceStart)
          const minutesUntil = (startAt.getTime() - now.getTime()) / 60_000
          if (minutesUntil < 0 || minutesUntil > reminder.minutesBefore) continue
          // The key (not the shown start) so an occurrence moved again does not fire twice.
          const key = new Date(occ.occurrenceKey ?? occ.occurrenceStart)
          if (reminder.lastSentOccurrence && reminder.lastSentOccurrence.getTime() === key.getTime()) continue

          // Fire-and-forget (regula din PLAN.md Sprint 2) — notifyPush nu aruncă niciodată
          // (failure izolat intern), acțiunea primară a acestei iterații e marcarea dedup-ului.
          void notifyPush(
            'calendarReminder',
            (locale) => ({
              title: trFor(locale, 'push.reminder.eventTitle', { title: occ.title }),
              body: startAt.toLocaleString(INTL_TAG[locale], { timeZone, dateStyle: 'short', timeStyle: 'short' }),
              url: '/calendar',
            }),
            recipients,
          )
          await db.update(calendarEventReminders).set({ lastSentOccurrence: key }).where(eq(calendarEventReminders.id, reminder.id))
          reminder.lastSentOccurrence = key
        }
      }
    } catch (err) {
      console.error(`[calendar-reminders] eveniment ${row.id} eșuat: ${String(err)}`)
    }
  }
}
