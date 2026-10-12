import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { SeriesPoint } from '@/shared/lib/types'
import { formatNumber } from '@/shared/lib/utils'

interface MetricAreaChartProps {
  data: SeriesPoint[]
  unit?: string | null
  height?: number
  /** Suprascrie precizia din `formatNumber` (2 zecimale) — necesar pt. valori cu variații mici, ex. curs valutar. */
  decimals?: number
  /** Domeniul axei Y — default `[0, 'auto']` (potrivit pt. sume). Curs valutar are nevoie de `['auto', 'auto']`, altfel variațiile mici dispar pe o scală care pornește din 0. */
  yDomain?: [number | string, number | string]
}

export function MetricAreaChart({ data, unit, height = 300, decimals, yDomain = [0, 'auto'] }: MetricAreaChartProps) {
  const points = data.map((d) => ({ ...d, label: formatDate(d.date) }))
  const format = (value: number) =>
    decimals === undefined ? formatNumber(value, unit) : `${new Intl.NumberFormat('ro-RO', { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(value)}${unit ? ` ${unit}` : ''}`

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="metricFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
            <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
        <YAxis
          domain={yDomain}
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          width={70}
          tickFormatter={decimals === undefined ? undefined : (value: number) => value.toFixed(decimals)}
        />
        <Tooltip
          formatter={(value: number) => [format(value), '']}
          contentStyle={{
            background: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 6,
            color: 'hsl(var(--card-foreground))',
          }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="hsl(var(--primary))"
          fill="url(#metricFill)"
          strokeWidth={2}
          isAnimationActive
          animationDuration={350}
          animationEasing="ease-out"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })
}
