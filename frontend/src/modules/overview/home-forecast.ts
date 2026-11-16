// "The company's weather" on the Home window: one sentence from fixed templates, never generated,
// so it says the same thing for the same day. The first cloud is the most serious thing.
export interface HomeSignals {
  critical: number
  warnings: number
  overdueInvoices: number
  /** Deadlines (declarations, invoices due, the ANAF token) in the next 3 days. */
  deadlinesSoon: number
  bookings: number
}

export type CloudKind = 'critical' | 'warning' | 'overdue' | 'deadline' | 'booking'

export interface HomeForecast {
  /** clear = nothing; one = a single thing; several; storm = something critical. */
  weather: 'clear' | 'one' | 'several' | 'storm'
  first: CloudKind | null
  count: number
}

export function homeForecast(signals: HomeSignals): HomeForecast {
  const ordered: [CloudKind, number][] = [
    ['critical', signals.critical],
    ['overdue', signals.overdueInvoices],
    ['deadline', signals.deadlinesSoon],
    ['warning', signals.warnings],
    ['booking', signals.bookings],
  ]
  const count = ordered.reduce((sum, [, n]) => sum + n, 0)
  const first = ordered.find(([, n]) => n > 0)?.[0] ?? null
  if (count === 0) return { weather: 'clear', first: null, count }
  if (signals.critical > 0) return { weather: 'storm', first, count }
  return { weather: count === 1 ? 'one' : 'several', first, count }
}
