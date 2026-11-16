import { describe, expect, it } from 'vitest'
import { momentAt } from './moment'

const at = (iso: string, zone: string) => momentAt(new Date(iso), zone)

describe('momentAt', () => {
  it('iarna, la granițe, în fusul firmei', () => {
    expect(at('2026-11-16T03:59:00Z', 'Europe/Bucharest')).toBe('noapte') // 05:59
    expect(at('2026-11-16T04:00:00Z', 'Europe/Bucharest')).toBe('rasarit') // 06:00
    expect(at('2026-11-16T06:59:00Z', 'Europe/Bucharest')).toBe('rasarit') // 08:59
    expect(at('2026-11-16T07:00:00Z', 'Europe/Bucharest')).toBe('zi') // 09:00
    expect(at('2026-11-16T14:59:00Z', 'Europe/Bucharest')).toBe('zi') // 16:59
    expect(at('2026-11-16T15:00:00Z', 'Europe/Bucharest')).toBe('apus') // 17:00
    expect(at('2026-11-16T18:00:00Z', 'Europe/Bucharest')).toBe('noapte') // 20:00
  })

  it('urmărește fusul firmei, nu al browserului', () => {
    expect(at('2026-11-16T05:00:00Z', 'America/New_York')).toBe('noapte') // 00:00
  })

  it('vara (UTC+3)', () => {
    expect(at('2026-07-01T04:00:00Z', 'Europe/Bucharest')).toBe('rasarit') // 07:00
    expect(at('2026-07-01T06:00:00Z', 'Europe/Bucharest')).toBe('zi') // 09:00
  })
})
