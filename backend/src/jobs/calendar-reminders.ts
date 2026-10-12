import cron from 'node-cron'
import { and, isNotNull, isNull, eq } from 'drizzle-orm'
import { db } from '../shared/db/client.js'
import { calendarEventAttendees, calendarEvents } from '../shared/db/schema/index.js'
import { notifyPush } from '../shared/lib/push.js'
import { expandOccurrence } from '../shared/lib/calendar-occurrences.js'
import { trFor } from '../shared/lib/i18n.js'
import { INTL_TAG } from '../shared/lib/locale.js'

// Reminder-uri push pt. evenimente de calendar (PLAN.md Sprint 2). Rulează la 5 minute —
// suficient de des ca un reminder de 5 min să nu rateze fereastra. Dedup pe ocurență
// (reminderSentAt ține timestamp-ul ULTIMEI ocurențe notificate, nu un boolean) — un
// eveniment recurent trebuie să notifice la FIECARE apariție, nu o singură dată vreodată.

const CRON_EXPR = '*/5 * * * *'
// Cea mai mare valoare din select-ul de reminder al UI-ului (fără/5/15/30/60 min) — fereastra
// de expandare RRULE trebuie să acopere cel puțin atât cât cel mai lung reminder configurat.
const MAX_LOOKAHEAD_MINUTES = 60

export function startCalendarRemindersJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runCalendarReminders().catch((err) => console.error(`[calendar-reminders] ${String(err)}`))
  })
  console.log(`[calendar-reminders] Scheduled (${CRON_EXPR})`)
}

export async function runCalendarReminders(): Promise<void> {
  const now = new Date()
  const windowEnd = new Date(now.getTime() + MAX_LOOKAHEAD_MINUTES * 60_000)

  const rows = await db
    .select()
    .from(calendarEvents)
    .where(and(isNull(calendarEvents.deletedAt), isNotNull(calendarEvents.reminderMinutesBefore)))

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
      const occurrences = expandOccurrence(row, now, windowEnd)
      for (const occ of occurrences) {
        const startAt = new Date(occ.occurrenceStart)
        const minutesUntil = (startAt.getTime() - now.getTime()) / 60_000
        if (minutesUntil < 0 || minutesUntil > (row.reminderMinutesBefore ?? 0)) continue
        if (row.reminderSentAt && row.reminderSentAt.getTime() === startAt.getTime()) continue

        // Fire-and-forget (regula din PLAN.md Sprint 2) — notifyPush nu aruncă niciodată
        // (failure izolat intern), acțiunea primară a acestei iterații e marcarea dedup-ului.
        void notifyPush(
          'calendarReminder',
          (locale) => ({
            title: trFor(locale, 'push.reminder.eventTitle', { title: row.title }),
            body: startAt.toLocaleString(INTL_TAG[locale], { timeZone: 'Europe/Bucharest', dateStyle: 'short', timeStyle: 'short' }),
            url: '/calendar',
          }),
          recipients,
        )
        await db.update(calendarEvents).set({ reminderSentAt: startAt }).where(eq(calendarEvents.id, row.id))
      }
    } catch (err) {
      console.error(`[calendar-reminders] eveniment ${row.id} eșuat: ${String(err)}`)
    }
  }
}
