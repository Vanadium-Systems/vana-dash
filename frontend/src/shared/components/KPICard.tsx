import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { cn } from '@/shared/lib/utils'
import { formatNumber } from '@/shared/lib/format'

interface KPICardProps {
  label: string
  value: number | null | undefined
  unit?: string | null
  isPending?: boolean
  hint?: string
  /** Colorează valoarea — ex. rată income/outcome. */
  tone?: 'positive' | 'negative'
  /** Delta vs. perioada anterioară, în procente — calculat din serii deja încărcate în client
      (Contractul G: fără rute backend noi; fără date de comparație → prop-ul rămâne netransmis). */
  deltaPct?: number | null
  deltaLabel?: string
  /** Mini-trend dreapta (boltnew) — seria deja încărcată, nu se refetch-uiește. */
  sparkline?: number[]
}

const TONE_CLASS: Record<NonNullable<KPICardProps['tone']>, string> = {
  positive: 'text-success dark:text-success',
  negative: 'text-destructive',
}

function SparklinePath({ points }: { points: number[] }) {
  if (points.length < 2) return null
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * 100
    const y = 24 - ((p - min) / span) * 22 - 1
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const rising = points[points.length - 1]! >= points[0]!
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-6 w-20" aria-hidden>
      <polyline
        points={coords.join(' ')}
        fill="none"
        strokeWidth={1.5}
        className={rising ? 'stroke-success' : 'stroke-destructive'}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export function KPICard({ label, value, unit, isPending, hint, tone, deltaPct, deltaLabel, sparkline }: KPICardProps) {
  const deltaRising = deltaPct != null && deltaPct >= 0
  // Săgeata e semantică pe direcția cifrei, nu pe semn: pentru o valoare "bună" creșterea e verde.
  const deltaClass =
    tone === 'negative'
      ? deltaRising
        ? 'text-destructive'
        : 'text-success'
      : deltaRising
        ? 'text-success'
        : 'text-destructive'
  return (
    <Card className="min-w-0">
      <CardHeader className="px-4 pb-1 pt-4">
        <CardTitle className="truncate text-xs font-medium text-muted-foreground" title={label}>
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="flex min-w-0 items-start justify-between gap-2">
          {isPending ? (
            <Skeleton className="h-8 w-28" />
          ) : (
            <div
              key={value ?? 'empty'}
              className={cn(
                'tnum min-w-0 animate-in whitespace-nowrap font-mono text-2xl font-semibold fade-in-0 duration-150',
                tone && TONE_CLASS[tone],
              )}
            >
              {value === null || value === undefined ? '—' : formatNumber(value, unit)}
            </div>
          )}
          {sparkline ? <SparklinePath points={sparkline} /> : null}
        </div>
        {deltaPct != null && !isPending ? (
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <span className={cn('tnum font-mono', deltaClass)}>
              {deltaRising ? '↑' : '↓'} {Math.abs(deltaPct).toFixed(1)}%
            </span>
            <span>{deltaLabel ?? 'vs. perioada anterioară'}</span>
          </p>
        ) : hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}
