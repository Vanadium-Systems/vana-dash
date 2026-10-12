import { describe, expect, it } from 'vitest'
import type { CalendarOccurrence } from './types'
import { canEditOccurrence, eventLabel } from './event-label'

const base: CalendarOccurrence = {
  eventId: 'e1',
  kind: 'event',
  source: 'manual',
  title: 'Contabil',
  description: null,
  location: null,
  allDay: false,
  color: null,
  isRecurring: false,
  recurrenceRule: null,
  recurrenceEndAt: null,
  occurrenceStart: '2026-10-01T09:00:00.000Z',
  occurrenceEnd: '2026-10-01T10:00:00.000Z',
  reminderMinutesBefore: null,
  ownerUserId: 'stefan',
  ownerName: 'Stefan',
  attendees: [],
  isCommon: false,
  access: 'owner',
}

describe('eventLabel', () => {
  it('pe calendarul tău, doar titlul', () => {
    expect(eventLabel(base)).toBe('Contabil')
  })

  it('pe calendarul altcuia, cu numele omului (nu doar prin culoare)', () => {
    expect(eventLabel({ ...base, access: 'view' })).toBe('Contabil · Stefan')
  })

  it('cheltuiala recurentă n-are proprietar', () => {
    expect(eventLabel({ ...base, kind: 'expense', access: null, ownerName: null })).toBe('Contabil')
  })
})

describe('canEditOccurrence', () => {
  it('„vede" și cheltuielile nu se mută; „editează" și al tău da', () => {
    expect(canEditOccurrence({ ...base, access: 'view' })).toBe(false)
    expect(canEditOccurrence({ ...base, kind: 'expense', access: null })).toBe(false)
    expect(canEditOccurrence({ ...base, access: 'edit' })).toBe(true)
    expect(canEditOccurrence(base)).toBe(true)
  })
})
