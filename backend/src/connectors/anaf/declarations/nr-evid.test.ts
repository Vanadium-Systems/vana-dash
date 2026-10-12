import { describe, expect, it } from 'vitest'
import { buildNrEvid } from './nr-evid.js'

describe('buildNrEvid', () => {
  it('produces the fixed 23-char control string for a mid-year period, mijl_trans=0', () => {
    // period 2026-07 → scadență 25.08.2026. Exemplul din PDF ('10301010912251012000029')
    // confirmă formatul poziție-cu-poziție, nu valorile exacte (alt an/lună) — verificăm
    // structura + suma de control aici.
    const nrEvid = buildNrEvid('2026-07', false)
    expect(nrEvid).toHaveLength(23)
    expect(nrEvid.slice(0, 2)).toBe('10')
    expect(nrEvid.slice(2, 5)).toBe('301')
    expect(nrEvid.slice(5, 7)).toBe('01')
    expect(nrEvid.slice(7, 11)).toBe('0726') // luna=07, an=26
    expect(nrEvid.slice(11, 17)).toBe('250826') // scadență 25.08.26
    expect(nrEvid.slice(17, 18)).toBe('0') // mijl_trans=0
    expect(nrEvid.slice(18, 21)).toBe('000')
  })

  it('rolls the due date into January of the next year for a December period', () => {
    const nrEvid = buildNrEvid('2026-12', false)
    expect(nrEvid.slice(7, 11)).toBe('1226')
    expect(nrEvid.slice(11, 17)).toBe('250127') // scadență 25.01.27
  })

  it('sets position 18 to 1 when mijl_trans=true', () => {
    const nrEvid = buildNrEvid('2026-07', true)
    expect(nrEvid.slice(17, 18)).toBe('1')
  })

  it('computes the control sum as the last 2 digits of the digit-sum of positions 1-21', () => {
    const nrEvid = buildNrEvid('2026-07', false)
    const first21 = nrEvid.slice(0, 21)
    const expectedSum = first21
      .split('')
      .reduce((sum, ch) => sum + Number(ch), 0)
    expect(nrEvid.slice(21, 23)).toBe(String(expectedSum % 100).padStart(2, '0'))
  })
})
