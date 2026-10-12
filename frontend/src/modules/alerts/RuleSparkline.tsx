import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/lib/api'

interface SparklinePoint {
  t: string
  v: number
}

/** Sparkline-ul seriei metricii regulii (Contract F) — SVG pur, fără Recharts per rând:
 *  un card de alertă are nevoie de o formă, nu de axe/tooltip. */
export function RuleSparkline({ ruleId }: { ruleId: string }) {
  const series = useQuery({
    queryKey: ['alert-rule-sparkline', ruleId],
    queryFn: () => api.get<{ points: SparklinePoint[] }>(`/api/alert-rules/${ruleId}/sparkline`),
    staleTime: 60_000,
  })

  const points = series.data?.points ?? []
  if (!series.isPending && points.length < 2) return null

  if (series.isPending) {
    return <div className="h-8 w-28 animate-pulse rounded bg-muted" />
  }

  const W = 112
  const H = 32
  const values = points.map((p) => p.v)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const stepX = W / (values.length - 1)
  // y-ul e inversat în coordonate SVG — min jos, max sus
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(2)},${(H - 2 - ((p.v - min) / span) * (H - 4)).toFixed(2)}`)
    .join(' ')

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0" data-testid="alert-rule-sparkline" aria-hidden>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground/70" />
      {/* ultimul punct evidențiat */}
      <circle
        cx={W}
        cy={H - 2 - ((values[values.length - 1]! - min) / span) * (H - 4)}
        r="2"
        className="fill-primary"
      />
    </svg>
  )
}
