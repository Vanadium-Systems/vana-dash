import { Bar, BarChart, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CHART_COLORS, CHART_NEUTRAL } from '@/shared/lib/chart-colors'
import { formatMoney, intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { SeriesPoint } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { LINE_CURSOR } from './chart-cursor'

// The chart shapes of the style (DESIGN.md "Charts"): the shape follows the question. Neutral,
// only today / what matters lit in the V blue; estimates hatched; no pie, funnel or stacked columns.

const TOOLTIP_STYLE = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 }
const AXIS_TICK = { fontSize: 11, fill: 'hsl(var(--text-3))' }

export interface DayColumn {
  date: string
  label: string
  value: number
  kind: 'past' | 'today' | 'forecast'
}

/** The days of a month from the series and the forecast: past, today, then the estimated days left. */
export function monthColumns(points: SeriesPoint[], forecast: SeriesPoint[], today: string): DayColumn[] {
  if (!today) return []
  const byDay = new Map(points.map((p) => [p.date.slice(0, 10), p.value]))
  const estimate = new Map(forecast.map((p) => [p.date, p.value]))
  const [year, month] = today.split('-').map(Number) as [number, number]
  const days = new Date(year, month, 0).getDate()
  const out: DayColumn[] = []
  for (let day = 1; day <= days; day++) {
    const date = `${today.slice(0, 8)}${String(day).padStart(2, '0')}`
    const kind: DayColumn['kind'] = date < today ? 'past' : date === today ? 'today' : 'forecast'
    out.push({ date, label: String(day), value: kind === 'forecast' ? (estimate.get(date) ?? 0) : (byDay.get(date) ?? 0), kind })
  }
  return out
}

/** "How much today": columns per day, today and the peak lit, the average dashed, the rest of the month hatched. */
export function DayColumns({ columns, currency, height, everyNth = 4 }: { columns: DayColumn[]; currency: string; height: number; everyNth?: number }) {
  const actual = columns.filter((c) => c.kind !== 'forecast')
  const peak = Math.max(0, ...actual.map((c) => c.value))
  const past = columns.filter((c) => c.kind === 'past')
  const average = past.length > 0 ? past.reduce((sum, c) => sum + c.value, 0) / past.length : 0
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={columns} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap={2}>
          {/* Inline: Recharts renders only its own children and raw SVG, not a component of ours. */}
          <defs>
            <pattern id="hatch-day-columns" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              {/* Through `style`: a CSS variable in an SVG presentation attribute is not resolved. */}
              <rect width="4" height="4" style={{ fill: 'hsl(var(--primary) / 0.08)' }} />
              <line x1="0" y1="0" x2="0" y2="4" strokeWidth="1.5" style={{ stroke: 'var(--hatch)' }} />
            </pattern>
          </defs>
          <XAxis dataKey="label" tickLine={false} axisLine={false} interval={everyNth} tick={AXIS_TICK} />
          <YAxis hide domain={[0, 'auto']} />
          <Tooltip
            cursor={{ fill: 'hsl(var(--accent))' }}
            contentStyle={TOOLTIP_STYLE}
            formatter={(value: number, _name, item) => [
              formatMoney(value, currency),
              (item.payload as DayColumn).kind === 'forecast' ? t('common:charts.estimate') : t('common:charts.actual'),
            ]}
            labelFormatter={(_label, payload) => (payload?.[0]?.payload as DayColumn | undefined)?.date ?? ''}
          />
          {average > 0 ? <ReferenceLine y={average} stroke="hsl(var(--text-3))" strokeDasharray="3 3" strokeWidth={1} /> : null}
          <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {columns.map((c) => {
              const lit = c.kind === 'today' || (peak > 0 && c.value === peak && c.kind !== 'forecast')
              return <Cell key={c.date} fill={c.kind === 'forecast' ? 'url(#hatch-day-columns)' : lit ? 'hsl(var(--primary))' : CHART_NEUTRAL} fillOpacity={lit || c.kind === 'forecast' ? 1 : 0.6} />
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** "Are we doing better than last time": this period as a line, the previous one dotted in the same hue. */
export function ComparisonLine({
  current,
  previous,
  currency,
  height,
  incompleteFrom,
}: {
  current: SeriesPoint[]
  previous: SeriesPoint[]
  currency: string
  height: number
  incompleteFrom: string | null
}) {
  // Aligned by position (day 1 with day 1), so the two periods sit on the same axis.
  const length = Math.max(current.length, previous.length)
  const data = Array.from({ length }, (_, i) => {
    const date = current[i]?.date.slice(0, 10)
    const value = current[i]?.value
    const running = Boolean(incompleteFrom && date && date >= incompleteFrom)
    return {
      label: date ? new Intl.DateTimeFormat(intlTag(), { day: 'numeric', month: 'short' }).format(new Date(`${date}T12:00:00Z`)) : '',
      current: running ? undefined : value,
      running: running || (incompleteFrom && current[i + 1]?.date.slice(0, 10) === incompleteFrom) ? value : undefined,
      previous: previous[i]?.value,
    }
  })
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} tick={AXIS_TICK} />
          <YAxis hide domain={[0, 'auto']} />
          <Tooltip cursor={LINE_CURSOR} contentStyle={TOOLTIP_STYLE} formatter={(value: number, name) => [formatMoney(value, currency), name === 'previous' ? t('common:charts.previous') : t('common:charts.current')]} />
          <Line dataKey="previous" stroke="hsl(var(--primary))" strokeOpacity={0.45} strokeDasharray="2 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line dataKey="current" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
          {/* The running bucket: dotted, it is still filling up. */}
          <Line dataKey="running" stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export interface ShareRow {
  id: string
  label: string
  value: number
}

function shareColor(index: number, isRest: boolean): string {
  return isRest ? CHART_NEUTRAL : (CHART_COLORS[index] ?? CHART_NEUTRAL)
}

/** "What the period is made of": one 28px split bar with percentages; at most 4 parts and "the rest". */
export function SplitBar({ rows, currency, restLabel }: { rows: ShareRow[]; currency: string; restLabel: string }) {
  const total = rows.reduce((sum, r) => sum + r.value, 0)
  if (total <= 0) return null
  const top = rows.slice(0, 4)
  const rest = rows.slice(4).reduce((sum, r) => sum + r.value, 0)
  const parts = rest > 0 ? [...top, { id: '__rest', label: restLabel, value: rest }] : top
  return (
    <div>
      <div className="flex h-7 w-full overflow-hidden rounded-sm" role="img" aria-label={parts.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(', ')}>
        {parts.map((part, i) => (
          <div key={part.id} className="h-full first:rounded-l-sm last:rounded-r-sm" style={{ width: `${(part.value / total) * 100}%`, background: shareColor(i, part.id === '__rest') }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        {parts.map((part, i) => (
          <li key={part.id} className="flex min-w-0 items-center gap-1.5 text-xs">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: shareColor(i, part.id === '__rest') }} aria-hidden="true" />
            <span className="truncate">{part.label}</span>
            <span className="whitespace-nowrap tnum text-muted-foreground">
              {Math.round((part.value / total) * 100)}% · {formatMoney(part.value, currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * "Who brings the most": horizontal bars ordered by amount, the sum and the share written. A click
 * on a row filters the whole page (DESIGN.md "Figures and money"); the active row stays lit.
 */
export function RankedBars({ rows, currency, activeId, onSelect }: { rows: ShareRow[]; currency: string; activeId?: string | null; onSelect?: (row: ShareRow) => void }) {
  const total = rows.reduce((sum, r) => sum + r.value, 0)
  const max = Math.max(0, ...rows.map((r) => r.value))
  if (total <= 0) return null
  return (
    <ul className="space-y-1">
      {rows.map((row) => {
        const share = Math.round((row.value / total) * 100)
        const active = activeId === row.id
        const content = (
          <>
            {/* The bar sits behind the label (Plausible), so the row stays one line. */}
            <span className={cn('absolute inset-y-0 left-0 rounded-sm', active ? 'bg-glow/20' : 'bg-primary/10')} style={{ width: `${max > 0 ? (row.value / max) * 100 : 0}%` }} aria-hidden="true" />
            <span className="relative min-w-0 flex-1 truncate text-left">{row.label}</span>
            <span className="relative whitespace-nowrap text-right tnum">{formatMoney(row.value, currency)}</span>
            <span className="relative w-10 shrink-0 text-right text-xs text-text-3 tnum">{share}%</span>
          </>
        )
        return (
          <li key={row.id}>
            {onSelect ? (
              // native: list row — the whole row is the target, a Button primitive would add its own padding and centring.
              <button type="button" aria-pressed={active} className={cn('relative flex min-h-control-md w-full items-center gap-3 rounded-sm px-2 text-sm', active && 'font-medium', 'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')} onClick={() => onSelect(row)}>
                {content}
              </button>
            ) : (
              <div className={cn('relative flex min-h-control-md w-full items-center gap-3 rounded-sm px-2 text-sm', active && 'font-medium')}>{content}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
