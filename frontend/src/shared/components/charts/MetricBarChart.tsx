import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatNumber } from '@/shared/lib/utils'

interface BarSeriesDef {
  key: string
  label: string
  color: string
}

interface MetricBarChartProps {
  data: Array<Record<string, string | number>>
  series: BarSeriesDef[]
  unit?: string | null
  height?: number
  /** Bare stivuite (ex: expense breakdown pe categorie) în loc de grupate una lângă alta. */
  stacked?: boolean
}

export function MetricBarChart({ data, series, unit, height = 300, stacked }: MetricBarChartProps) {
  const labelByKey = new Map(series.map((s) => [s.key, s.label]))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={70} />
        <Tooltip
          formatter={(value: number, name: string) => [formatNumber(value, unit), labelByKey.get(name) ?? name]}
          contentStyle={{
            background: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 6,
            color: 'hsl(var(--card-foreground))',
          }}
        />
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.key}
            fill={s.color}
            radius={[2, 2, 0, 0]}
            stackId={stacked ? 'stack' : undefined}
            isAnimationActive
            animationDuration={350}
            animationEasing="ease-out"
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
