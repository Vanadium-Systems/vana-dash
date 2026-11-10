// iCalendar (RFC 5545) building blocks shared by the booking confirmation and meeting invitations.

export function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** RFC 5545 §3.3.11: backslash, semicolon, comma and newline are escaped. */
export function escapeIcsText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** RFC 5545 §3.1: a line over 75 octets continues on the next one, led by a space. */
export function foldLine(line: string): string {
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

/** Folds every line and joins with CRLF, the closing CRLF included. */
export function joinIcsLines(lines: string[]): string {
  return lines.map(foldLine).join('\r\n').concat('\r\n')
}

// A quoted parameter value cannot hold a double quote (RFC 5545 3.2).
const quotedParam = (value: string) => `"${value.replace(/"/g, '')}"`

export interface IcsPerson {
  name?: string
  email: string
}

export interface IcsOrganizer {
  name: string
  email: string
}

export interface MeetingIcsInput {
  uid: string
  sequence: number
  method: 'REQUEST' | 'CANCEL'
  start: Date
  end: Date
  summary: string
  description: string
  location: string | null
  organizer: IcsOrganizer
  attendees: IcsPerson[]
}

/** An invitation people can answer (REQUEST) or its withdrawal (CANCEL). A later SEQUENCE under the
 *  same UID replaces the earlier invitation in the recipient's calendar. */
export function buildMeetingIcs(input: MeetingIcsInput): string {
  return joinIcsLines([
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VanaDash//Meeting//EN',
    `METHOD:${input.method}`,
    'BEGIN:VEVENT',
    `UID:${input.uid}`,
    `SEQUENCE:${input.sequence}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(input.start)}`,
    `DTEND:${icsDate(input.end)}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
    ...(input.description ? [`DESCRIPTION:${escapeIcsText(input.description)}`] : []),
    ...(input.location ? [`LOCATION:${escapeIcsText(input.location)}`] : []),
    `STATUS:${input.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    `ORGANIZER;CN=${quotedParam(input.organizer.name)}:mailto:${input.organizer.email}`,
    ...input.attendees.map(
      (a) => `ATTENDEE;${a.name ? `CN=${quotedParam(a.name)};` : ''}RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:${a.email}`,
    ),
    'END:VEVENT',
    'END:VCALENDAR',
  ])
}
