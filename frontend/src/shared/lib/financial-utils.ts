import type { PnlByMonth, SeriesPoint } from './types'

// Extras din FinancialsPage — reutilizat și în Overview pt. cardul de Venituri
// (trebuie să numere venitul exact la fel: doar facturile plătite, direction='out').
export function sumByDirection(
  rows: PnlByMonth[] | undefined,
  direction: 'in' | 'out',
  statuses?: PnlByMonth['paymentStatus'][],
): number | null {
  if (!rows) return null
  return rows
    .filter((r) => r.direction === direction && (!statuses || statuses.includes(r.paymentStatus)))
    .reduce((sum, r) => sum + r.total, 0)
}

// Combină două serii zilnice (ex: revenue din platform_metrics + revenue din financial_records)
// într-una singură, sumând valorile pe aceeași zi calendaristică — folosit în Overview ca cele
// două surse de venit să apară pe un singur grafic, nu unul lângă altul.
export function mergeSeriesByDay(...series: SeriesPoint[][]): SeriesPoint[] {
  const byDay = new Map<string, number>()
  for (const points of series) {
    for (const point of points) {
      const day = point.date.slice(0, 10)
      byDay.set(day, (byDay.get(day) ?? 0) + point.value)
    }
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }))
}
