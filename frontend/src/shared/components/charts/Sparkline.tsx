import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { chartColor } from '@/shared/lib/chart-colors'
import type { HealthHistoryPoint } from '@/shared/lib/types'

interface SparklineProps {
  data: HealthHistoryPoint[]
  height?: number
}

/** Sparkline CPU/RAM/disk pe 7 zile — Track A (monitorizare server). */
export function Sparkline({ data, height = 220 }: SparklineProps) {
  const points = data.map((d) => ({ ...d, label: formatDateTime(d.captured_at) }))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={points} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={35} />
        <Tooltip
          formatter={(value: number, name: string) => [`${value.toFixed(1)}%`, name]}
          contentStyle={{
            background: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 6,
            color: 'hsl(var(--card-foreground))',
          }}
        />
        <Line
          type="monotone"
          dataKey="cpu_pct"
          name="CPU"
          stroke={chartColor(0)}
          strokeWidth={2}
          dot={false}
          isAnimationActive
          animationDuration={350}
          animationEasing="ease-out"
        />
        <Line
          type="monotone"
          dataKey="ram_pct"
          name="RAM"
          stroke={chartColor(1)}
          strokeWidth={2}
          dot={false}
          isAnimationActive
          animationDuration={350}
          animationEasing="ease-out"
        />
        <Line
          type="monotone"
          dataKey="disk_pct"
          name="Disk"
          stroke={chartColor(2)}
          strokeWidth={2}
          dot={false}
          isAnimationActive
          animationDuration={350}
          animationEasing="ease-out"
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
