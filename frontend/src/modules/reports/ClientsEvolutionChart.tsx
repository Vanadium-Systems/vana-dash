import { Area, AreaChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { LINE_CURSOR } from '@/shared/components/charts/chart-cursor'
import { CHART_NEUTRAL } from '@/shared/lib/chart-colors'
import { formatNumber } from '@/shared/lib/format'

interface ClientsEvolutionChartProps {
  data: Array<{ label: string; active: number; demo: number }>
  activeLabel: string
  demoLabel: string
  height?: number
}

const PRIMARY = 'hsl(var(--primary))'
const MUTED = 'hsl(var(--muted-foreground))'

export function ClientsEvolutionChart({ data, activeLabel, demoLabel, height = 300 }: ClientsEvolutionChartProps) {
  const labelByKey = new Map([
    ['active', activeLabel],
    ['demo', demoLabel],
  ])
  const last = data.length - 1

  // The current value sits at the end of each line, so the legend is not needed to read it.
  const endLabel = (fill: string) =>
    function EndLabel(props: { x?: number | string; y?: number | string; value?: number | string; index?: number }) {
      // A zero on top of the stack would sit on the other series' label.
      if (props.index !== last || props.value === undefined || Number(props.value) === 0) return null
      return (
        <text x={Number(props.x) + 6} y={Number(props.y)} dy={4} fontSize={12} fill={fill}>
          {formatNumber(Number(props.value), 'count')}
        </text>
      )
    }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 32, left: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={70} />
        <Tooltip
          cursor={LINE_CURSOR}
          formatter={(value: number, name: string) => [formatNumber(value, 'count'), labelByKey.get(name) ?? name]}
          contentStyle={{
            background: 'hsl(var(--card))',
            border: '1px solid hsl(var(--border))',
            borderRadius: 6,
            color: 'hsl(var(--card-foreground))',
          }}
        />
        <Area type="monotone" dataKey="active" name="active" stackId="clients" stroke={PRIMARY} strokeWidth={2} fill={PRIMARY} fillOpacity={0.25} isAnimationActive animationDuration={350} animationEasing="ease-out">
          <LabelList dataKey="active" content={endLabel(PRIMARY)} />
        </Area>
        <Area type="monotone" dataKey="demo" name="demo" stackId="clients" stroke={CHART_NEUTRAL} strokeWidth={2} fill={CHART_NEUTRAL} fillOpacity={0.25} isAnimationActive animationDuration={350} animationEasing="ease-out">
          <LabelList dataKey="demo" content={endLabel(MUTED)} />
        </Area>
      </AreaChart>
    </ResponsiveContainer>
  )
}
