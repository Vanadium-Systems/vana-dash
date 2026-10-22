import type { bookings } from '../../shared/db/schema/index.js'

// Invitația atașată la emailul de confirmare. PUBLISH, nu REQUEST: e un memento în calendarul
// vizitatorului, nu o invitație la care să răspundă.

function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** RFC 5545 §3.3.11: backslash, punct și virgulă, virgulă și rând nou se escapează. */
export function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** RFC 5545 §3.1: rândurile peste 75 de octeți continuă pe rândul următor, cu un spațiu în față. */
function foldLine(line: string): string {
  const parts: string[] = []
  let current = ''
  for (const char of line) {
    if (Buffer.byteLength(current + char) > (parts.length === 0 ? 75 : 74)) {
      parts.push(current)
      current = ''
    }
    current += char
  }
  parts.push(current)
  return parts.join('\r\n ')
}

export function buildBookingIcs(
  booking: Pick<typeof bookings.$inferSelect, 'id' | 'startAt' | 'endAt' | 'topic'>,
  callUrl: string | null = null,
): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Vanadium Systems//VanaDash//RO',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${booking.id}@vanadium.systems`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(booking.startAt)}`,
    `DTEND:${icsDate(booking.endAt)}`,
    `SUMMARY:${escapeIcsText('Apel cu Vanadium Systems')}`,
    `DESCRIPTION:${escapeIcsText([booking.topic ?? '', callUrl ?? ''].filter(Boolean).join('\n\n'))}`,
    ...(callUrl ? [`LOCATION:${escapeIcsText(callUrl)}`, `URL:${callUrl}`] : []),
    'ORGANIZER;CN=Vanadium Systems:mailto:contact@vanadium.systems',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .map(foldLine)
    .join('\r\n')
    .concat('\r\n')
}
