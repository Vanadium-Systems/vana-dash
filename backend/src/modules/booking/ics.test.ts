import { describe, expect, it } from 'vitest'
import { buildBookingIcs, escapeIcsText } from './ics.js'

describe('ics', () => {
  it('escapează textul vizitatorului, ca să nu poată adăuga proprietăți noi', () => {
    expect(escapeIcsText('a;b,c\\d\nEND:VEVENT')).toBe('a\\;b\\,c\\\\d\\nEND:VEVENT')
  })

  it('pliază rândurile lungi la 75 de octeți și folosește CRLF', () => {
    const ics = buildBookingIcs({ id: 'x', startAt: new Date('2031-03-03T08:00:00.000Z'), endAt: new Date('2031-03-03T08:30:00.000Z'), topic: 'ă'.repeat(200) })
    const lines = ics.split('\r\n')
    expect(lines.every((l) => Buffer.byteLength(l) <= 75)).toBe(true)
    expect(ics).toContain('DTSTART:20310303T080000Z')
    expect(lines.filter((l) => l === 'END:VEVENT')).toHaveLength(1)
  })
})
