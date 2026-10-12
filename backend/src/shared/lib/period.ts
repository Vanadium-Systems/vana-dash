// Parsează perioada din query (?period=30d|7d|90d|mtd|ytd) sau from/to custom.
export interface PeriodRange {
  from: Date
  to: Date
}

export function resolvePeriod(period?: string, from?: string, to?: string): PeriodRange {
  const now = new Date()
  if (from && to) return { from: new Date(from), to: new Date(to) }

  switch (period ?? '30d') {
    case 'mtd':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now }
    case 'ytd':
      return { from: new Date(now.getFullYear(), 0, 1), to: now }
    case '7d':
      return { from: daysAgo(now, 7), to: now }
    case '90d':
      return { from: daysAgo(now, 90), to: now }
    case '30d':
    default:
      return { from: daysAgo(now, 30), to: now }
  }
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}
