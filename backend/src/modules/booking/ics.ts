import type { bookings } from '../../shared/db/schema/index.js'
import { escapeIcsText, icsDate, joinIcsLines, type IcsOrganizer } from '../../shared/lib/ics.js'

export { escapeIcsText }

// Invitația atașată la emailul de confirmare. PUBLISH, nu REQUEST: e un memento în calendarul
// vizitatorului, nu o invitație la care să răspundă.

export function buildBookingIcs(
  booking: Pick<typeof bookings.$inferSelect, 'id' | 'startAt' | 'endAt' | 'topic'>,
  organizer: IcsOrganizer,
  callUrl: string | null = null,
): string {
  return joinIcsLines([
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VanaDash//Booking//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${booking.id}@vanadash`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(booking.startAt)}`,
    `DTEND:${icsDate(booking.endAt)}`,
    `SUMMARY:${escapeIcsText(`Apel cu ${organizer.name}`)}`,
    `DESCRIPTION:${escapeIcsText([booking.topic ?? '', callUrl ?? ''].filter(Boolean).join('\n\n'))}`,
    ...(callUrl ? [`LOCATION:${escapeIcsText(callUrl)}`, `URL:${callUrl}`] : []),
    // A quoted CN cannot hold a double quote (RFC 5545 3.2).
    ...(organizer.email ? [`ORGANIZER;CN="${organizer.name.replace(/"/g, '')}":mailto:${organizer.email}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ])
}
