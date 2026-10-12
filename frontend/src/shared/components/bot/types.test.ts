import { describe, expect, it } from 'vitest'
import { CHART_COLORS, CHART_NEUTRAL } from '@/shared/lib/chart-colors'
import { botStatus, formatAge, formatPct, returnPct, safeHttpUrl, strategyColor } from './types'

describe('botStatus', () => {
  it('online până la 15 min, întârzie până la 30, apoi offline', () => {
    expect(botStatus(0)).toBe('online')
    expect(botStatus(15)).toBe('online')
    expect(botStatus(16)).toBe('late')
    expect(botStatus(30)).toBe('late')
    expect(botStatus(31)).toBe('offline')
  })
})

describe('safeHttpUrl', () => {
  it('lasă doar http(s)', () => {
    expect(safeHttpUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(safeHttpUrl('data:text/html,<b>x</b>')).toBeNull()
    expect(safeHttpUrl('nu e url')).toBeNull()
  })
})

describe('strategyColor', () => {
  it('referința e gri, culorile urmează strategia, nu poziția în clasament', () => {
    expect(strategyColor('hold')).toBe(CHART_NEUTRAL)
    expect(strategyColor('mix')).toBe(CHART_COLORS[0])
    expect(strategyColor('lgbm')).toBe(CHART_COLORS[4])
    expect(strategyColor('necunoscută')).toBe(CHART_NEUTRAL)
  })
})

describe('formatare', () => {
  it('randament cu semn, inclusiv zero și negativ', () => {
    expect(formatPct(returnPct({ equity: 2927.12, startEquity: 3000 }))).toBe('-2.43%')
    expect(formatPct(returnPct({ equity: 1000, startEquity: 1000 }))).toBe('0.00%')
    expect(formatPct(returnPct({ equity: 1084.5, startEquity: 1000 }))).toBe('+8.45%')
    expect(returnPct({ equity: 5, startEquity: 0 })).toBe(0)
  })

  it('vârsta snapshot-ului', () => {
    expect(formatAge(0)).toBe('acum câteva secunde')
    expect(formatAge(45)).toBe('acum 45 min')
    expect(formatAge(180)).toBe('acum 3 h')
    expect(formatAge(60 * 72)).toBe('acum 3 zile')
  })
})
