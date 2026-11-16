import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { Delta } from '@/shared/components/Delta'
import { Money } from '@/shared/components/Money'
import { PageHeader } from '@/shared/components/PageHeader'
import { PeriodSelector, usePeriod } from '@/shared/components/PeriodSelector'
import { ChartEmpty, ChartError, ChartSkeleton } from '@/shared/components/charts/chart-states'
import { MetricBarChart } from '@/shared/components/charts/MetricBarChart'
import { ComparisonLine, DayColumns, monthColumns, RankedBars, SplitBar, type ShareRow } from '@/shared/components/charts/question-charts'
import { useUrlState } from '@/shared/hooks/use-url-state'
import { api } from '@/shared/lib/api'
import { categoryLabel, sumByDirection } from '@/shared/lib/financial-utils'
import type { CashflowEntry, Delta as DeltaValue, ExchangeRatePoint, PnlByCategory, PnlByMonth, PnlResponse, RevenueSeries } from '@/shared/lib/types'
import { formatMoney, formatNumber, intlTag } from '@/shared/lib/format'
import { BnrRateChart, type BnrRatePoint } from './BnrRateChart'
import { ReportsFolder } from './ReportsFolder'
import { t } from '@/shared/lib/i18n'
import { approx, MoneyNote } from '@/shared/components/MoneyNote'
import { useMoneyQuery } from '@/shared/hooks/use-money-query'
import { BASE_CURRENCY } from '@/shared/lib/locale'

// Financials (DESIGN.md "Charts", "Figures and money"; archetype C, analytics). One metric at a
// time (Venit / Cheltuieli / Profit), the figures with their change against the previous period,
// the chart whose shape answers the question, and breakdowns where a click on a row narrows the
// whole page (`?filtru=client:<id>`, removable chip). Everything that changes the view is in the URL.

const BAR_SERIES = [
  { key: 'out', label: t('financials:labels.revenueCollected'), color: 'hsl(var(--primary))' },
  { key: 'in', label: t('financials:labels.expenses'), color: 'var(--s0)' },
]

const CASHFLOW_LABELS: Record<CashflowEntry['paymentStatus'], string> = {
  paid: t('financials:status.paid'),
  partial: t('financials:status.partiallyPaid'),
  unpaid: t('financials:status.unpaid'),
}

type Metric = 'revenue' | 'expenses' | 'profit'
const METRICS: Metric[] = ['revenue', 'expenses', 'profit']

/** The previous period, in words, for the deltas ("față de perioada anterioară" / "față de octombrie"). */
function againstLabel(period: string): string {
  if (period !== 'mtd') return t('financials:compare.previousPeriod')
  const now = new Date()
  return new Intl.DateTimeFormat(intlTag(), { month: 'long' }).format(new Date(now.getFullYear(), now.getMonth() - 1, 15))
}

function granularityFor(period: string): 'day' | 'week' | 'month' {
  if (period === 'ytd') return 'month'
  if (period === '90d') return 'week'
  return 'day'
}

interface Annotation {
  key: string
  text: string
}

/** The largest change between the two periods, written on the page; closing it is remembered for the session. */
function biggestChange(current: PnlByCategory[] | undefined, previous: PnlByCategory[] | undefined, currency: string, only?: 'in' | 'out'): Annotation | null {
  if (!current || !previous) return null
  const sum = (rows: PnlByCategory[], category: string, direction: 'in' | 'out') =>
    rows.filter((r) => r.category === category && r.direction === direction).reduce((total, r) => total + r.total, 0)
  let best: { category: string; direction: 'in' | 'out'; change: number } | null = null
  const keys = new Set([...current, ...previous].map((r) => `${r.direction}|${r.category}`))
  for (const key of keys) {
    const [direction, category] = key.split('|') as ['in' | 'out', string]
    if (only && direction !== only) continue
    const change = sum(current, category, direction) - sum(previous, category, direction)
    if (!best || Math.abs(change) > Math.abs(best.change)) best = { category, direction, change }
  }
  if (!best || Math.abs(best.change) < 1) return null
  const params = { category: categoryLabel(best.category), value: formatMoney(Math.abs(best.change), currency) }
  const key = best.direction === 'in' ? (best.change > 0 ? 'expenseUp' : 'expenseDown') : best.change > 0 ? 'revenueUp' : 'revenueDown'
  return { key: `${key}:${best.category}:${Math.round(best.change)}`, text: t(`financials:annotation.${key}`, params) }
}

export function FinancialsPage() {
  const period = usePeriod()
  const [metricParam, setMetric] = useUrlState('metrica', 'revenue')
  const metric = (METRICS.includes(metricParam as Metric) ? metricParam : 'revenue') as Metric
  const [filter, setFilter] = useUrlState('filtru', '')
  const [filterLabel, setFilterLabel] = useState<string | null>(null)
  const [closedNote, setClosedNote] = useState(() => sessionStorage.getItem('financials.annotation.closed'))

  const filterParam = filter ? `&filter=${encodeURIComponent(filter)}` : ''
  const pnl = useMoneyQuery<PnlResponse>(['financials', 'pnl', period, 'compare', filter], `/api/financials/pnl?period=${period}&compare=previous${filterParam}`)
  const series = useMoneyQuery<RevenueSeries>(
    ['financials', 'revenue-series', period, filter],
    `/api/financials/revenue-series?period=${period}&compare=previous&granularity=${granularityFor(period)}${period === 'mtd' ? '&forecast=1' : ''}${filterParam}`,
  )
  const cashflow = useMoneyQuery<CashflowEntry[]>(['financials', 'cashflow', period, filter], `/api/financials/cashflow?period=${period}${filterParam}`)
  // Live from recurring_expenses, not financial_records: a recurring cost created a minute ago has
  // no materialised row yet (the cron writes one at nextDueDate).
  const recurringExpensesMonthly = useMoneyQuery<{ monthlyRon: number; monthlyDisplay: number }>(['financials', 'recurring-expenses'], '/api/financials/recurring-expenses')

  const money = pnl.money
  const currency = t(`common:money.units.${money?.currency ?? BASE_CURRENCY}`)
  const against = againstLabel(period)

  // 'out' = issued (revenue), 'in' = received (cost). Collected = paid issued invoices only.
  const collected = sumByDirection(pnl.data?.byMonth, 'out', ['paid'])
  const pendingRevenue = sumByDirection(pnl.data?.byMonth, 'out', ['unpaid', 'partial'])
  const expense = sumByDirection(pnl.data?.byMonth, 'in')
  const pendingExpense = sumByDirection(pnl.data?.byMonth, 'in', ['unpaid', 'partial'])
  const profit = collected != null && expense != null ? collected - expense : null
  const previousCollected = sumByDirection(pnl.data?.previous?.byMonth, 'out', ['paid'])
  const previousExpense = sumByDirection(pnl.data?.previous?.byMonth, 'in')
  const deltaOf = (current: number | null, previous: number | null): DeltaValue | null =>
    current == null || previous == null ? null : { abs: (current - previous).toFixed(2), pct: previous === 0 ? null : Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10 }

  const primary = {
    revenue: { label: t('financials:labels.revenueCollected'), value: collected, delta: deltaOf(collected, previousCollected), higherIsBetter: true },
    expenses: { label: t('financials:labels.expenses'), value: expense, delta: deltaOf(expense, previousExpense), higherIsBetter: false },
    profit: {
      label: t('financials:kpi.netProfit'),
      value: profit,
      delta: deltaOf(profit, previousCollected != null && previousExpense != null ? previousCollected - previousExpense : null),
      higherIsBetter: true,
    },
  }[metric]
  const secondary = [
    metric !== 'revenue' && { label: t('financials:labels.revenueCollected'), value: collected },
    { label: t('financials:kpi.invoicedPending'), value: pendingRevenue },
    metric !== 'expenses' && { label: t('financials:labels.expenses'), value: expense },
    { label: t('financials:kpi.expensesPending'), value: pendingExpense },
    { label: t('financials:kpi.recurringMonthly'), value: recurringExpensesMonthly.data?.monthlyDisplay ?? null },
  ].filter((f): f is { label: string; value: number | null } => Boolean(f))

  const categoryRows = (direction: 'in' | 'out'): ShareRow[] =>
    pivotByCategory(pnl.data?.byCategory)
      .map((row) => ({ id: `category:${row.category}`, label: categoryLabel(row.category), value: direction === 'in' ? row.in : row.out }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value)
  const clientRows: ShareRow[] = (pnl.data?.byClient ?? []).filter((r) => r.id).map((r) => ({ id: `client:${r.id}`, label: r.name ?? '—', value: r.total }))
  const platformRows: ShareRow[] = (pnl.data?.byPlatform ?? []).map((r) => ({
    id: r.id ? `platform:${r.id}` : 'platform:none',
    label: r.name ?? t('financials:breakdown.noPlatform'),
    value: r.total,
  }))
  const select = (row: ShareRow) => {
    if (row.id === filter) {
      setFilter('')
      return
    }
    // "No platform" cannot be a filter: there is no id to narrow on.
    if (row.id === 'platform:none') return
    setFilter(row.id)
    setFilterLabel(row.label)
  }

  const annotation = biggestChange(pnl.data?.byCategory, pnl.data?.previous?.byCategory, currency, metric === 'expenses' ? 'in' : metric === 'revenue' ? 'out' : undefined)
  const showAnnotation = annotation && closedNote !== annotation.key

  return (
    <div className="space-y-6">
      <PageHeader title={t('common:nav.financials')} actions={<PeriodSelector />} />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={metric} onValueChange={setMetric}>
          <TabsList variant="segmented" aria-label={t('financials:metric.label')}>
            {METRICS.map((m) => (
              <TabsTrigger key={m} value={m}>
                {t(`financials:metric.${m}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {filter ? (
          <span className="inline-flex h-control-sm items-center gap-1 rounded-md border border-glow/40 bg-glow/10 pl-2.5 text-sm">
            {t('financials:filter.chip', { name: filterLabel ?? filter.slice(filter.indexOf(':') + 1) })}
            <Button variant="ghost" size="icon-sm" aria-label={t('financials:filter.remove')} onClick={() => setFilter('')}>
              <X />
            </Button>
          </span>
        ) : null}
      </div>

      <section aria-label={t('financials:figures.label')} className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{primary.label}</p>
          {pnl.isPending ? (
            <Skeleton className="mt-1 h-9 w-48" />
          ) : (
            <p className="text-figure font-semibold tracking-title">
              {primary.value == null ? '—' : <Money amount={primary.value} currency={currency} tabular={false} sign={metric === 'profit'} />}
            </p>
          )}
          {primary.delta ? <Delta delta={primary.delta} currency={currency} against={against} higherIsBetter={primary.higherIsBetter} className="mt-1 block" /> : null}
        </div>
        {secondary.map((figure) => (
          <div key={figure.label} className="min-w-0">
            <p className="truncate text-xs text-muted-foreground">{figure.label}</p>
            <p className="mt-0.5 text-lg font-medium">{pnl.isPending || figure.value == null ? '—' : <Money amount={figure.value} currency={currency} tabular={false} />}</p>
          </div>
        ))}
      </section>
      <MoneyNote money={money} />

      {showAnnotation ? (
        <div role="note" className="flex items-center justify-between gap-3 rounded-md bg-muted px-4 py-2 text-sm">
          <p className="min-w-0">{annotation.text}</p>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('common:actions.close')}
            onClick={() => {
              sessionStorage.setItem('financials.annotation.closed', annotation.key)
              setClosedNote(annotation.key)
            }}
          >
            <X />
          </Button>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t(`financials:charts.${metric === 'expenses' ? 'expenseMix' : metric === 'profit' ? 'revenueVsExpenses' : period === 'mtd' ? 'byDay' : 'againstPrevious'}`)}</CardTitle>
        </CardHeader>
        <CardContent>
          {metric === 'revenue' ? (
            series.isPending ? (
              <ChartSkeleton height={240} />
            ) : series.isError ? (
              <ChartError message={t('common:states.loadFailed')} />
            ) : period === 'mtd' ? (
              <DayColumns columns={monthColumns(series.data?.points ?? [], series.data?.forecast ?? [], series.data?.today ?? '')} currency={currency} height={240} />
            ) : (
              <ComparisonLine current={series.data?.points ?? []} previous={series.data?.previous?.points ?? []} currency={currency} height={240} incompleteFrom={series.data?.incompleteFrom ?? null} />
            )
          ) : metric === 'expenses' ? (
            pnl.isPending ? (
              <ChartSkeleton height={80} />
            ) : categoryRows('in').length === 0 ? (
              <EmptyState kind={filter ? 'filtered' : 'new'} title={t('financials:empty')} onReset={() => setFilter('')} />
            ) : (
              <SplitBar rows={categoryRows('in')} currency={currency} restLabel={t('financials:breakdown.rest')} />
            )
          ) : pnl.isPending ? (
            <ChartSkeleton height={300} />
          ) : (
            <MetricBarChart data={pivotByMonth(pnl.data?.byMonth)} series={BAR_SERIES} unit={money?.currency ?? BASE_CURRENCY} />
          )}
          {metric === 'revenue' && period === 'mtd' ? <p className="mt-2 text-xs text-text-3">{t('financials:charts.byDayLegend')}</p> : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {metric !== 'expenses' ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('financials:breakdown.clients')}</CardTitle>
            </CardHeader>
            <CardContent>
              {pnl.isPending ? (
                <ChartSkeleton height={160} />
              ) : clientRows.length === 0 ? (
                <EmptyState kind={filter ? 'filtered' : 'new'} title={t('financials:empty')} onReset={() => setFilter('')} />
              ) : (
                <RankedBars rows={clientRows} currency={currency} activeId={filter} onSelect={select} />
              )}
            </CardContent>
          </Card>
        ) : null}
        <Card className={metric === 'expenses' ? 'lg:col-span-2' : undefined}>
          <CardHeader>
            <CardTitle>{t(metric === 'expenses' ? 'financials:breakdown.expenseCategories' : 'financials:breakdown.revenueCategories')}</CardTitle>
          </CardHeader>
          <CardContent>
            {pnl.isPending ? (
              <ChartSkeleton height={160} />
            ) : categoryRows(metric === 'expenses' ? 'in' : 'out').length === 0 ? (
              <EmptyState kind={filter ? 'filtered' : 'new'} title={t('financials:empty')} onReset={() => setFilter('')} />
            ) : (
              <RankedBars rows={categoryRows(metric === 'expenses' ? 'in' : 'out')} currency={currency} activeId={filter} onSelect={select} />
            )}
          </CardContent>
        </Card>
        {metric !== 'expenses' && platformRows.length > 1 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('financials:breakdown.platforms')}</CardTitle>
            </CardHeader>
            <CardContent>
              <RankedBars rows={platformRows} currency={currency} activeId={filter} onSelect={select} />
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('financials:cashFlow.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {cashflow.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : cashflow.isError ? (
            <ChartError message={t('common:states.loadFailed')} />
          ) : !cashflow.data?.length ? (
            <EmptyState kind={filter ? 'filtered' : 'new'} title={t('financials:empty')} onReset={() => setFilter('')} />
          ) : (
            <div className="kpi-grid gap-x-8 gap-y-4">
              {cashflow.data.map((entry) => (
                <div key={`${entry.direction}-${entry.paymentStatus}`} className="min-w-0">
                  <div className="truncate text-xs text-muted-foreground">
                    {entry.direction === 'out' ? t('financials:cashFlow.issued') : t('financials:cashFlow.received')} · {CASHFLOW_LABELS[entry.paymentStatus]}
                  </div>
                  <div className="whitespace-nowrap text-lg font-medium">{approx(formatNumber(entry.total, cashflow.money?.currency ?? BASE_CURRENCY), cashflow.money)}</div>
                  <div className="text-xs text-text-3">{t('common:count.records', { count: entry.count })}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ReportsFolder />

      <ExchangeRateCard />
    </div>
  )
}

type BnrRangeKey = 'week' | 'month' | 'year'

const BNR_RANGE_OPTIONS: [BnrRangeKey, string][] = [
  ['week', t('financials:bnr.rangeWeek')],
  ['month', t('financials:bnr.rangeMonth')],
  ['year', t('financials:bnr.rangeYear')],
]

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d)
  next.setDate(next.getDate() + n)
  return next
}

function isWeekend(d: Date): boolean {
  const day = d.getDay()
  return day === 0 || day === 6
}

function bnrRangeStart(range: BnrRangeKey, today: Date): Date {
  if (range === 'week') {
    const dow = (today.getDay() + 6) % 7 // luni=0
    return addDays(today, -dow)
  }
  if (range === 'month') return new Date(today.getFullYear(), today.getMonth(), 1)
  return new Date(today.getFullYear(), 0, 1)
}

/**
 * Umple fiecare zi din [displayStart, displayEnd] — o zi fără sync reușit (jobs/bnr-daily-fetch.ts)
 * reportează ultimul curs cunoscut (comportamentul real folosit la facturare, `getRateForDate`),
 * marcată `missedSync` DOAR dacă e zi lucrătoare (weekend = normal, BNR nu publică). `fetchStart`
 * pornește cu 7 zile înainte de `displayStart` — doar ca să existe un curs de reportat chiar din
 * prima zi afișată, fără să apară în grafic.
 */
function buildBnrSeries(rows: ExchangeRatePoint[], fetchStart: Date, displayStart: Date, displayEnd: Date): BnrRatePoint[] {
  const byDate = new Map(rows.map((r) => [r.date, Number(r.rate)]))
  const result: BnrRatePoint[] = []
  let lastKnown: number | null = null
  for (let cursor = fetchStart; cursor <= displayEnd; cursor = addDays(cursor, 1)) {
    const key = toDateKey(cursor)
    const exact = byDate.get(key)
    if (exact !== undefined) lastKnown = exact
    if (cursor < displayStart || lastKnown === null) continue
    result.push({ date: key, value: lastKnown, missedSync: exact === undefined && !isWeekend(cursor) })
  }
  return result
}

// Sprint D, Track 2 — curs BNR curent EUR/USD + istoric zilnic, din GET /api/financials/exchange-rates
// (actualizat zilnic de jobs/bnr-daily-fetch.ts). Redus la o singură granularitate (zi, 2026-09-21 —
// agregarea pe lună/an nu adăuga nimic util pe o serie deja zilnică) + 3 ferestre calendaristice.
function ExchangeRateCard() {
  const [currency, setCurrency] = useState<'EUR' | 'USD'>('EUR')
  const [range, setRange] = useState<BnrRangeKey>('week')

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const displayStart = bnrRangeStart(range, today)
  const fetchStart = addDays(displayStart, -7)

  const history = useQuery({
    queryKey: ['financials', 'exchange-rates', currency, toDateKey(displayStart), toDateKey(today)],
    queryFn: () =>
      api.get<ExchangeRatePoint[]>(
        `/api/financials/exchange-rates?currency=${currency}&period=daily&from=${toDateKey(fetchStart)}&to=${toDateKey(today)}`,
      ),
  })

  const chartData = history.data ? buildBnrSeries(history.data, fetchStart, displayStart, today) : []
  const latest = history.data?.at(-1)

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 space-y-0">
        <CardTitle>{t('financials:bnr.title')}</CardTitle>
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex overflow-hidden rounded-md border">
            {(['EUR', 'USD'] as const).map((c) => (
              // native: segmented control
              <button
                key={c}
                type="button"
                className={`px-3 py-1 text-xs font-medium ${currency === c ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                onClick={() => setCurrency(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="inline-flex overflow-hidden rounded-md border">
            {BNR_RANGE_OPTIONS.map(([value, label]) => (
              // native: segmented control
              <button
                key={value}
                type="button"
                className={`px-3 py-1 text-xs font-medium ${range === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                onClick={() => setRange(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="whitespace-nowrap text-2xl font-semibold">{latest ? `1 ${currency} = ${Number(latest.rate).toFixed(4)} ${BASE_CURRENCY}` : '—'}</p>
          {latest && <p className="text-sm text-muted-foreground">{t('financials:bnr.asOf', { date: latest.date })}</p>}
        </div>
        {history.isPending ? (
          <ChartSkeleton height={220} />
        ) : history.isError ? (
          <ChartError message={t('financials:bnr.loadFailed')} />
        ) : !chartData.length ? (
          <ChartEmpty label={t('financials:bnr.noHistory')} />
        ) : (
          <BnrRateChart data={chartData} decimals={4} height={220} />
        )}
      </CardContent>
    </Card>
  )
}

// "out" (venituri) numără doar liniile plătite — restul e "facturat, în așteptare" (KPI
// separat, nu în acest grafic). "in" (cheltuieli) rămâne pe toate stările.
function pivotByMonth(rows: PnlByMonth[] | undefined): Array<{ label: string; in: number; out: number }> {
  if (!rows?.length) return []
  const byMonth = new Map<string, { label: string; in: number; out: number }>()
  for (const row of rows) {
    if (row.direction === 'out' && row.paymentStatus !== 'paid') continue
    const entry = byMonth.get(row.month) ?? {
      label: new Date(row.month).toLocaleDateString(intlTag(), { month: 'short', year: '2-digit' }),
      in: 0,
      out: 0,
    }
    entry[row.direction] += row.total
    byMonth.set(row.month, entry)
  }
  return [...byMonth.values()]
}

interface CategoryRow {
  category: string
  in: number
  out: number
}

function pivotByCategory(rows: PnlByCategory[] | undefined): CategoryRow[] {
  if (!rows?.length) return []
  const byCategory = new Map<string, CategoryRow>()
  for (const row of rows) {
    if (row.direction === 'out' && row.paymentStatus !== 'paid') continue
    const entry = byCategory.get(row.category) ?? { category: row.category, in: 0, out: 0 }
    entry[row.direction] += row.total
    byCategory.set(row.category, entry)
  }
  return [...byCategory.values()].sort((a, b) => b.out + b.in - (a.out + a.in))
}
