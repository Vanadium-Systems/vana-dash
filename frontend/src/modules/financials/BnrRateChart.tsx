import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { intlTag } from '@/shared/lib/format'

export interface BnrRatePoint {
  date: string
  value: number
  /** Zi lucrătoare fără sync reușit (jobs/bnr-daily-fetch.ts) — valoarea afișată e reportată
   *  de la ultimul curs cunoscut, nu una nouă publicată de BNR în ziua asta. */
  missedSync: boolean
}

interface BnrRateChartProps {
  data: BnrRatePoint[]
  decimals?: number
  height?: number
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(intlTag(), { day: 'numeric', month: 'short' })
}

// Punct roșu = zi lucrătoare în care cronul BNR nu a prins un curs nou (SICAP-style
// indicator, cerere Stefan 2026-09-21) — linia rămâne continuă (reportăm ultimul curs
// cunoscut), doar punctul respectiv marchează vizual lipsa sync-ului.
function RateDot(props: { cx?: number; cy?: number; payload?: BnrRatePoint }) {
  const { cx, cy, payload } = props
  if (cx == null || cy == null || !payload) return null
  if (!payload.missedSync) return <circle cx={cx} cy={cy} r={2.5} fill="hsl(var(--primary))" stroke="none" />
  return <circle cx={cx} cy={cy} r={3.5} fill="hsl(var(--destructive))" stroke="hsl(var(--destructive))" />
}

function ChartTooltip({
  active,
  payload,
  decimals,
}: {
  active?: boolean
  payload?: { payload: BnrRatePoint & { label: string } }[]
  decimals: number
}) {
  if (!active || !payload?.length) return null
  const point = payload[0]!.payload
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs text-card-foreground shadow-sm">
      <div className="font-medium">{point.label}</div>
      <div className="tnum font-mono">{point.value.toFixed(decimals)} RON</div>
      {point.missedSync && <div className="mt-1 text-destructive">sync BNR eșuat — curs reportat</div>}
    </div>
  )
}

export function BnrRateChart({ data, decimals = 4, height = 220 }: BnrRateChartProps) {
  const points = data.map((d) => ({ ...d, label: formatDate(d.date) }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="bnrFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
        <YAxis
          domain={['auto', 'auto']}
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={70}
          tickFormatter={(value: number) => value.toFixed(decimals)}
        />
        <Tooltip content={<ChartTooltip decimals={decimals} />} />
        <Area
          type="monotone"
          dataKey="value"
          stroke="hsl(var(--primary))"
          fill="url(#bnrFill)"
          strokeWidth={2}
          dot={<RateDot />}
          activeDot={{ r: 4 }}
          isAnimationActive
          animationDuration={350}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
