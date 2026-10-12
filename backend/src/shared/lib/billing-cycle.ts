// Sprint C, Track D: port 1:1 din vanagreen (recyclers_app/backend/src/shared/lib/billing-cycle.ts)
// — vana-dash devine proprietarul complet al cadenței de facturare recurente, vanagreen renunță
// la calculul propriu. Funcții pure, zero dependență DB.

export type BillingCycle = 'monthly' | 'annual'

export interface BillingCycleConfig {
  cycle: BillingCycle
  day: number
  /** Necesar pt. `annual`, ignorat pt. `monthly`. */
  month?: number | null
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Întoarce cea mai apropiată dată ≥ `fromDate` care se potrivește cu pattern-ul de cadență, ca
 * string ISO `YYYY-MM-DD`. Folosit atât pt. a semăna data inițială (`fromDate = azi`), cât și pt.
 * a rostogoli cadența înainte după ce a expirat (`fromDate = data anterioară + 1 zi`).
 */
export function computeNextOccurrence(config: BillingCycleConfig, fromDate: Date): string {
  const { cycle, day } = config
  const fromUtc = Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate())

  if (cycle === 'monthly') {
    const year = fromDate.getUTCFullYear()
    const month = fromDate.getUTCMonth()
    const candidate = Date.UTC(year, month, day)
    const next = candidate >= fromUtc ? candidate : Date.UTC(year, month + 1, day)
    return toIsoDate(new Date(next))
  }

  // annual
  const month = config.month ?? 1
  const year = fromDate.getUTCFullYear()
  const candidate = Date.UTC(year, month - 1, day)
  const next = candidate >= fromUtc ? candidate : Date.UTC(year + 1, month - 1, day)
  return toIsoDate(new Date(next))
}

/**
 * Calculează data care urmează după `dueDate` (ziua calendaristică + 1), folosită ca ancoră
 * `fromDate` la rostogolirea unei cadențe expirate — garantează că următoarea apariție e strict
 * după perioada care tocmai s-a încheiat, chiar dacă cron-ul rulează exact în ziua scadenței.
 */
export function dayAfter(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + 1))
}
