import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { homeForecast, type HomeSignals } from './home-forecast'

const none: HomeSignals = { critical: 0, warnings: 0, overdueInvoices: 0, deadlinesSoon: 0, bookings: 0 }
const locale = (lang: string) => JSON.parse(readFileSync(resolve(__dirname, `../../locales/${lang}/overview.json`), 'utf8')).window

describe('homeForecast', () => {
  it('nimic: senin', () => {
    expect(homeForecast(none)).toEqual({ weather: 'clear', first: null, count: 0 })
  })

  it('un singur lucru: one, cu primul corect', () => {
    expect(homeForecast({ ...none, bookings: 1 })).toEqual({ weather: 'one', first: 'booking', count: 1 })
    expect(homeForecast({ ...none, overdueInvoices: 1 }).first).toBe('overdue')
  })

  it('mai multe: several, primul după ordinea critic > restanță > termen > atenție > programare', () => {
    expect(homeForecast({ ...none, bookings: 2, warnings: 1 })).toEqual({ weather: 'several', first: 'warning', count: 3 })
    expect(homeForecast({ ...none, warnings: 1, deadlinesSoon: 1 }).first).toBe('deadline')
    expect(homeForecast({ ...none, deadlinesSoon: 1, overdueInvoices: 1 }).first).toBe('overdue')
  })

  it('orice critic: storm', () => {
    expect(homeForecast({ ...none, critical: 1 })).toEqual({ weather: 'storm', first: 'critical', count: 1 })
    expect(homeForecast({ ...none, critical: 1, bookings: 4 }).weather).toBe('storm')
  })

  it('șabloanele există în ambele limbi', () => {
    for (const lang of ['ro', 'en']) {
      const window = locale(lang)
      for (const weather of ['clear', 'one', 'several', 'storm']) expect(window.weather[weather], `${lang} weather.${weather}`).toBeTruthy()
      for (const cloud of ['critical', 'warning', 'overdue', 'deadline', 'booking']) expect(window.cloud[cloud], `${lang} cloud.${cloud}`).toBeTruthy()
    }
    const ro = locale('ro')
    const en = locale('en')
    for (const suffix of ['_one', '_few', '_other']) expect(ro[`needsAttention${suffix}`], `ro ${suffix}`).toBeTruthy()
    for (const suffix of ['_one', '_other']) expect(en[`needsAttention${suffix}`], `en ${suffix}`).toBeTruthy()
  })
})
