import { useEffect, useState } from 'react'
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Delta } from '@/shared/components/Delta'
import { Money } from '@/shared/components/Money'
import { APPROX } from '@/shared/components/MoneyNote'
import { useMe } from '@/shared/hooks/use-me'
import { useMoneyQuery } from '@/shared/hooks/use-money-query'
import { companyToday } from '@/shared/components/PeriodSelect'
import { CHART_COLORS } from '@/shared/lib/chart-colors'
import { categoryLabel } from '@/shared/lib/financial-utils'
import { companyTimeZone, formatDate, formatMoney, formatNumber, intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { tNodes } from '@/shared/lib/i18n-nodes'
import { BASE_CURRENCY } from '@/shared/lib/locale'
import type { PnlResponse, RevenueSeries } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { WidgetFrame, widgetState } from './WidgetFrame'
import type { WidgetProps } from './types'

export const COLLECTED_KEY = ['financials', 'revenue-series', 'mtd', 'compare', 'forecast']
export const COLLECTED_PATH = '/api/financials/revenue-series?period=mtd&compare=previous&forecast=1'

export function useCollectedThisMonth() {
  return useMoneyQuery<RevenueSeries>(COLLECTED_KEY, COLLECTED_PATH, { staleTime: 30_000 })
}

/** "octombrie": the month the comparison runs against, in the company's time zone. */
export function previousMonthName(): string {
  const now = new Date()
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 15)
  return new Intl.DateTimeFormat(intlTag(), { month: 'long', timeZone: companyTimeZone() }).format(previous)
}

export function CollectedWidget({ preview }: WidgetProps) {
  const series = useCollectedThisMonth()
  const currency = t(`common:money.units.${series.money?.currency ?? BASE_CURRENCY}`)
  return (
    <WidgetFrame
      title={t('overview:widgets.collected')}
      module={t('common:nav.financials')}
      action={{ to: '/financials', label: t('overview:widgets.openFinancials') }}
      updatedAt={series.dataUpdatedAt}
      state={widgetState(series, false)}
      onRetry={() => void series.refetch()}
      preview={preview}
    >
      <p className="text-2xl font-semibold tnum">
        {series.money?.converted ? `${APPROX} ` : null}
        <Money amount={series.data?.total ?? 0} currency={currency} />
      </p>
      {series.data?.delta ? <Delta delta={series.data.delta} currency={currency} against={previousMonthName()} className="mt-1 block" /> : null}
    </WidgetFrame>
  )
}

interface DayBar {
  date: string
  label: string
  value: number
  kind: 'past' | 'today' | 'forecast'
}

/**
 * The month by day (DESIGN.md "Charts", "how much today"): neutral columns, only today and the
 * peak lit in the V blue, the average as a fine line, the days left hatched with the run-rate
 * forecast and written "Estimare".
 */
export function RevenueWidget({ size, preview }: WidgetProps) {
  const series = useCollectedThisMonth()
  const { session } = useMe()
  const currency = t(`common:money.units.${series.money?.currency ?? BASE_CURRENCY}`)
  const data = series.data
  const today = data?.today ?? ''

  const byDay = new Map((data?.points ?? []).map((p) => [p.date.slice(0, 10), p.value]))
  const bars: DayBar[] = []
  if (data) {
    const [year, month] = today.split('-').map(Number) as [number, number]
    const days = new Date(year, month, 0).getDate()
    const forecast = new Map(data.forecast.map((p) => [p.date, p.value]))
    for (let day = 1; day <= days; day++) {
      const date = `${today.slice(0, 8)}${String(day).padStart(2, '0')}`
      const kind: DayBar['kind'] = date < today ? 'past' : date === today ? 'today' : 'forecast'
      const value = kind === 'forecast' ? (forecast.get(date) ?? 0) : (byDay.get(date) ?? 0)
      bars.push({ date, label: String(day), value, kind })
    }
  }
  const actual = bars.filter((b) => b.kind !== 'forecast')
  const peak = actual.reduce((max, b) => (b.value > max ? b.value : max), 0)
  const workedDays = actual.filter((b) => b.kind === 'past').length
  const average = workedDays > 0 ? actual.filter((b) => b.kind === 'past').reduce((sum, b) => sum + b.value, 0) / workedDays : 0
  const forecastTotal = bars.filter((b) => b.kind === 'forecast').reduce((sum, b) => sum + b.value, 0)
  const hidden = session?.hideAmounts
  // A wide or band row is 11rem: header, figure and footer leave about 56px for the columns.
  const height = size === 'l' ? 220 : 56

  return (
    <WidgetFrame
      title={t('overview:widgets.revenue')}
      module={t('common:nav.financials')}
      action={{ to: '/financials', label: t('overview:widgets.openFinancials') }}
      updatedAt={series.dataUpdatedAt}
      state={widgetState(series, false)}
      onRetry={() => void series.refetch()}
      preview={preview}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-lg font-semibold tnum">
          <Money amount={data?.total ?? 0} currency={currency} />
        </span>
        {data?.delta && size !== 's' ? <Delta delta={data.delta} currency={currency} against={previousMonthName()} /> : null}
        {forecastTotal > 0 && !hidden ? (
          <span className="text-xs text-muted-foreground">
            {t('overview:widgets.forecastToMonthEnd', { value: formatMoney((data?.total ?? 0) + forecastTotal, currency) })}
          </span>
        ) : null}
      </div>
      {hidden ? null : (
        <div className="mt-2" style={{ height }} aria-hidden={preview || undefined}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap={2}>
              <defs>
                <pattern id="hatch-forecast" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="4" height="4" style={{ fill: 'hsl(var(--primary) / 0.08)' }} />
                  <line x1="0" y1="0" x2="0" y2="4" strokeWidth="1.5" style={{ stroke: 'var(--hatch)' }} />
                </pattern>
              </defs>
              <XAxis dataKey="label" tickLine={false} axisLine={false} interval={size === 'band' ? 1 : 4} tick={{ fontSize: 11, fill: 'hsl(var(--text-3))' }} />
              <YAxis hide domain={[0, 'auto']} />
              <Tooltip
                cursor={{ fill: 'hsl(var(--accent))' }}
                formatter={(value: number, _name, item) => [
                  formatMoney(value, currency),
                  (item.payload as DayBar).kind === 'forecast' ? t('overview:widgets.estimate') : t('overview:widgets.collected'),
                ]}
                labelFormatter={(_label, payload) => (payload?.[0]?.payload as DayBar | undefined)?.date ?? ''}
                contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 12 }}
              />
              {average > 0 ? <ReferenceLine y={average} stroke="hsl(var(--text-3))" strokeDasharray="3 3" strokeWidth={1} /> : null}
              <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {bars.map((bar) => (
                  <Cell
                    key={bar.date}
                    fill={bar.kind === 'forecast' ? 'url(#hatch-forecast)' : bar.kind === 'today' || (bar.value === peak && peak > 0) ? 'hsl(var(--primary))' : 'var(--s0)'}
                    fillOpacity={bar.kind === 'forecast' ? 1 : bar.kind === 'today' || bar.value === peak ? 1 : 0.55}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {average > 0 && size === 'l' ? <p className="mt-1 text-xs text-text-3">{t('overview:widgets.average', { value: formatMoney(average, currency) })}</p> : null}
    </WidgetFrame>
  )
}

interface CategorySlice {
  key: string
  label: string
  total: number
  color: string
}

// The four categorical slots in their fixed order; everything past the fourth goes to "the rest" in neutral.
const SLICE_COLORS = [CHART_COLORS[0], CHART_COLORS[1], CHART_COLORS[2], CHART_COLORS[3]]
const REST_COLOR = 'var(--s0)'

export function ExpensesByCategoryWidget({ size, preview }: WidgetProps) {
  const pnl = useMoneyQuery<PnlResponse>(['financials', 'pnl', 'mtd', 'by-category'], '/api/financials/pnl?period=mtd', { staleTime: 30_000 })
  const currency = t(`common:money.units.${pnl.money?.currency ?? BASE_CURRENCY}`)

  // `in` is money leaving the company (the P&L totals call it "expense"); one category comes in several rows, one per payment status.
  const byCategory = new Map<string, number>()
  for (const row of pnl.data?.byCategory ?? []) {
    if (row.direction === 'in') byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + row.total)
  }
  const sorted = [...byCategory.entries()].filter(([, total]) => total > 0).sort((a, b) => b[1] - a[1])
  const total = sorted.reduce((sum, [, value]) => sum + value, 0)
  const top: CategorySlice[] = sorted.slice(0, 4).map(([key, value], index) => ({ key, label: categoryLabel(key), total: value, color: SLICE_COLORS[index]! }))
  const restTotal = sorted.slice(4).reduce((sum, [, value]) => sum + value, 0)
  const slices: CategorySlice[] = restTotal > 0 ? [...top, { key: '_rest', label: t('overview:expenses.rest'), total: restTotal, color: REST_COLOR }] : top
  const share = (value: number) => formatNumber(Math.round((value / total) * 100), '%')

  return (
    <WidgetFrame
      title={t('overview:widgets.expensesByCategory')}
      module={t('common:nav.financials')}
      action={{ to: '/financials', label: t('overview:widgets.openFinancials') }}
      updatedAt={pnl.dataUpdatedAt}
      state={widgetState(pnl, total === 0)}
      emptyText={t('overview:expenses.none')}
      onRetry={() => void pnl.refetch()}
      preview={preview}
    >
      <div className="flex h-7 gap-0.5 overflow-hidden rounded-md" aria-hidden="true">
        {slices.map((slice) => (
          <span key={slice.key} className="h-full min-w-0.5" style={{ flexGrow: slice.total, flexBasis: 0, background: slice.color }} />
        ))}
      </div>
      <ul className={cn('mt-2 gap-x-4 gap-y-1', size === 'l' ? 'space-y-1' : 'grid grid-cols-2')}>
        {(size === 'l' ? [...top, ...sorted.slice(4, 8).map(([key, value]) => ({ key, label: categoryLabel(key), total: value, color: REST_COLOR }))] : slices).map((slice) => (
          <li key={slice.key} className="flex min-w-0 items-center gap-2 text-xs">
            <span className="size-2 shrink-0 rounded-sm" style={{ background: slice.color }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{slice.label}</span>
            <span className="shrink-0 text-muted-foreground">
              <Money amount={slice.total} currency={currency} /> · {share(slice.total)}
            </span>
          </li>
        ))}
      </ul>
    </WidgetFrame>
  )
}

const CELL = 10
const GAP = 3
const WEEKS = 53
// Four steps of the V blue; an empty day stays `bg-muted`.
const LEVEL_OPACITY = [0.25, 0.5, 0.75, 1]

const isoDay = (date: Date) => date.toISOString().slice(0, 10)
const addDays = (day: string, days: number) => {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return isoDay(date)
}
const dayLabel = (day: string) => formatDate(`${day}T12:00:00`)
/** 0 = Monday, so a column reads Monday to Sunday. */
const weekdayIndex = (day: string) => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7

/** The width of an element, followed while it resizes: the grid takes the weeks that fit, so it never scrolls sideways. */
function useWidth() {
  // A state, not a ref: the node only exists once the frame leaves its loading state.
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!node) return
    const observer = new ResizeObserver(() => setWidth(node.clientWidth))
    observer.observe(node)
    setWidth(node.clientWidth)
    return () => observer.disconnect()
  }, [node])
  return [setNode, width] as const
}

export function YearGridWidget({ preview }: WidgetProps) {
  const today = companyToday()
  const from = addDays(today, -364)
  const series = useMoneyQuery<RevenueSeries>(
    ['financials', 'revenue-series', 'year-grid', today],
    `/api/financials/revenue-series?from=${from}T00:00:00.000Z&to=${new Date().toISOString()}&granularity=day`,
    { staleTime: 30_000 },
  )
  const { session } = useMe()
  const currency = t(`common:money.units.${series.money?.currency ?? BASE_CURRENCY}`)
  const hidden = session?.hideAmounts
  const [ref, width] = useWidth()

  const byDay = new Map((series.data?.points ?? []).map((point) => [point.date.slice(0, 10), point.value]))
  const columns = Math.max(1, Math.min(WEEKS, Math.floor((width + GAP) / (CELL + GAP))))
  // The grid ends with this week; it starts on the Monday `columns - 1` weeks earlier.
  const start = addDays(today, -weekdayIndex(today) - (columns - 1) * 7)
  const days: { date: string; value: number }[] = []
  for (let day = start; day <= today; day = addDays(day, 1)) days.push({ date: day, value: byDay.get(day) ?? 0 })
  const peak = days.reduce((max, day) => Math.max(max, day.value), 0)
  const level = (value: number) => (value <= 0 || peak <= 0 ? -1 : Math.min(3, Math.ceil((value / peak) * 4) - 1))

  return (
    <WidgetFrame
      title={t('overview:widgets.yearGrid')}
      module={t('common:nav.financials')}
      action={{ to: '/financials', label: t('overview:widgets.openFinancials') }}
      updatedAt={series.dataUpdatedAt}
      state={widgetState(series, false)}
      onRetry={() => void series.refetch()}
      preview={preview}
    >
      <div ref={ref} className="min-w-0">
        <p className="mb-2 text-xs text-muted-foreground">{tNodes('overview:yearGrid.total', { total: <Money amount={series.data?.total ?? 0} currency={currency} /> })}</p>
        <div className="grid grid-flow-col" style={{ gridTemplateRows: `repeat(7, ${CELL}px)`, gap: GAP }}>
          {days.map((day) => {
            const step = level(day.value)
            return (
              <span
                key={day.date}
                title={hidden ? dayLabel(day.date) : `${dayLabel(day.date)} · ${formatMoney(day.value, currency)}`}
                className={cn('rounded-sm', step < 0 && 'bg-muted')}
                style={{ width: CELL, height: CELL, ...(step >= 0 && { background: `hsl(var(--primary) / ${LEVEL_OPACITY[step]})` }) }}
              />
            )
          })}
        </div>
      </div>
    </WidgetFrame>
  )
}
