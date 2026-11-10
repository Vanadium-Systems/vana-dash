// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { presetRange } from './PeriodSelect'

describe('presetRange', () => {
  it('luna, luna trecută, trimestrul și anul, în zilele firmei', () => {
    expect(presetRange('thisMonth', '2026-02-10')).toEqual(['2026-02-01', '2026-02-28'])
    expect(presetRange('lastMonth', '2026-01-15')).toEqual(['2025-12-01', '2025-12-31'])
    expect(presetRange('thisQuarter', '2026-11-10')).toEqual(['2026-10-01', '2026-12-31'])
    expect(presetRange('thisYear', '2026-11-10')).toEqual(['2026-01-01', '2026-12-31'])
  })
})
