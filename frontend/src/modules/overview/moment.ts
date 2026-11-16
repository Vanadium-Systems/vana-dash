// The Home window follows the time of day in the company's time zone, not the browser's: a
// colleague abroad sees the company's evening.
export type Moment = 'rasarit' | 'zi' | 'apus' | 'noapte'

export function hourIn(date: Date, timeZone: string): number {
  const hour = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(date)
  return Number(hour)
}

/** Sunrise 06-09, day 09-17, sunset 17-20, night otherwise. */
export function momentAt(date: Date, timeZone: string): Moment {
  const hour = hourIn(date, timeZone)
  if (hour >= 6 && hour < 9) return 'rasarit'
  if (hour >= 9 && hour < 17) return 'zi'
  if (hour >= 17 && hour < 20) return 'apus'
  return 'noapte'
}

/** The resin takes its light from the photo of the moment. */
export const MOMENT_LIGHT: Record<Moment, [string, string, string, string]> = {
  rasarit: ['#ff8a4c', '#ffc98a', '#6f8fd8', '#c9d6f5'],
  zi: ['#ffc58a', '#9fb4ff', '#3d5bd9', '#e6ecff'],
  apus: ['#ff9d6b', '#ee86b4', '#7d9cff', '#c8b4ff'],
  noapte: ['#5ff0e8', '#2fc4dd', '#2a6ff0', '#9ff7f4'],
}
