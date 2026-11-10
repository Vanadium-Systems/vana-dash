import { describe, expect, it } from 'vitest'
import { buildMeetingIcs, escapeIcsText } from './ics.js'

const base = {
  uid: 'task-1@vanadash',
  sequence: 0,
  method: 'REQUEST' as const,
  start: new Date('2031-03-03T08:00:00.000Z'),
  end: new Date('2031-03-03T08:45:00.000Z'),
  summary: 'Meeting with Acme',
  description: 'Agenda',
  location: 'Office',
  organizer: { name: 'Jane Doe', email: 'jane@example.com' },
  attendees: [{ name: 'Ion Pop', email: 'ion@acme.example' }, { email: 'office@acme.example' }],
}

describe('buildMeetingIcs', () => {
  it('writes a REQUEST in UTC with organizer and one RSVP attendee per address', () => {
    const ics = buildMeetingIcs(base)
    const lines = ics.replace(/\r\n /g, '').split('\r\n')
    expect(ics.endsWith('\r\n')).toBe(true)
    expect(lines).toContain('METHOD:REQUEST')
    expect(lines).toContain('UID:task-1@vanadash')
    expect(lines).toContain('SEQUENCE:0')
    expect(lines).toContain('DTSTART:20310303T080000Z')
    expect(lines).toContain('DTEND:20310303T084500Z')
    expect(lines).toContain('STATUS:CONFIRMED')
    expect(lines.some((l) => /^DTSTAMP:\d{8}T\d{6}Z$/.test(l))).toBe(true)
    expect(lines).toContain('ORGANIZER;CN="Jane Doe":mailto:jane@example.com')
    expect(lines).toContain('ATTENDEE;CN="Ion Pop";RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:ion@acme.example')
    expect(lines).toContain('ATTENDEE;RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:office@acme.example')
  })

  it('a CANCEL carries STATUS:CANCELLED and the higher SEQUENCE', () => {
    const lines = buildMeetingIcs({ ...base, method: 'CANCEL', sequence: 3 }).split('\r\n')
    expect(lines).toContain('METHOD:CANCEL')
    expect(lines).toContain('STATUS:CANCELLED')
    expect(lines).toContain('SEQUENCE:3')
  })

  it('escapes commas, semicolons, backslashes and newlines in text fields', () => {
    expect(escapeIcsText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne')
    const ics = buildMeetingIcs({ ...base, summary: 'A, B; C', description: 'one\ntwo', location: 'Room 1, floor 2' })
    expect(ics).toContain('SUMMARY:A\\, B\\; C')
    expect(ics).toContain('DESCRIPTION:one\\ntwo')
    expect(ics).toContain('LOCATION:Room 1\\, floor 2')
  })

  it('folds lines at 75 octets, multibyte characters included', () => {
    const ics = buildMeetingIcs({ ...base, description: 'ă'.repeat(200) })
    const lines = ics.split('\r\n')
    expect(lines.every((l) => Buffer.byteLength(l) <= 75)).toBe(true)
    const unfolded = ics.replace(/\r\n /g, '')
    expect(unfolded).toContain(`DESCRIPTION:${'ă'.repeat(200)}`)
  })

  it('leaves out an empty location and strips quotes from a CN', () => {
    const ics = buildMeetingIcs({ ...base, location: null, organizer: { name: 'Jane "J" Doe', email: 'jane@example.com' } })
    expect(ics).not.toContain('LOCATION')
    expect(ics).toContain('CN="Jane J Doe"')
  })
})
