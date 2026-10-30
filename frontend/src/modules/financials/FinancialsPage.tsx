import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { KPICard } from '@/shared/components/KPICard'
import { PageHeader } from '@/shared/components/PageHeader'
import { PeriodSelector, usePeriod } from '@/shared/components/PeriodSelector'
import { ChartEmpty, ChartError, ChartSkeleton } from '@/shared/components/charts/chart-states'
import { MetricBarChart } from '@/shared/components/charts/MetricBarChart'
import { api } from '@/shared/lib/api'
import { sumByDirection } from '@/shared/lib/financial-utils'
import type { CashflowEntry, ExchangeRatePoint, PnlByCategory, PnlByMonth, PnlResponse } from '@/shared/lib/types'
import { formatNumber, intlTag } from '@/shared/lib/format'
import { BnrRateChart, type BnrRatePoint } from './BnrRateChart'
import { t } from '@/shared/lib/i18n'
import { approx, MoneyNote } from '@/shared/components/MoneyNote'
import { useMoneyQuery } from '@/shared/hooks/use-money-query'
import { BASE_CURRENCY } from '@/shared/lib/locale'

const BAR_SERIES = [
  { key: 'out', label: t('financials:labels.revenueCollected'), color: 'hsl(var(--primary))' },
  { key: 'in', label: t('financials:labels.expenses'), color: 'hsl(var(--destructive))' },
]

const CASHFLOW_LABELS: Record<CashflowEntry['paymentStatus'], string> = {
  paid: t('financials:status.paid'),
  partial: t('financials:status.partiallyPaid'),
  unpaid: t('financials:status.unpaid'),
}

export function FinancialsPage() {
  const period = usePeriod()

  const pnl = useMoneyQuery<PnlResponse>(['financials', 'pnl', period], `/api/financials/pnl?period=${period}`)
  const cashflow = useMoneyQuery<CashflowEntry[]>(['financials', 'cashflow', period], `/api/financials/cashflow?period=${period}`)
  // Calculat LIVE din recurring_expenses, nu din financial_records — o cheltuială recurentă abia
  // creată n-are încă niciun rând materializat (cron-ul scrie unul doar la nextDueDate), deci
  // fără query-ul ăsta separat ar fi invizibilă pe Financials până la următoarea rulare de cron.
  const recurringExpensesMonthly = useMoneyQuery<{ monthlyRon: number; monthlyDisplay: number }>(
    ['financials', 'recurring-expenses'],
    '/api/financials/recurring-expenses',
  )
  // The server says which currency the totals are in; nothing here assumes lei.
  const money = pnl.money
  const currency = money?.currency ?? BASE_CURRENCY
  const converted = money?.converted

  // direction: 'out' = factură emisă de Stefan (venit), 'in' = document primit (cheltuială).
  // "Venituri" = doar facturile plătite — o factură emisă dar neîncasată nu e venit realizat,
  // e doar facturat/în așteptare (card separat mai jos). Cheltuielile rămân pe toate stările
  // (o factură primită e o obligație din momentul emiterii, indiferent dacă a fost plătită).
  const revenue = sumByDirection(pnl.data?.byMonth, 'out', ['paid'])
  const pendingRevenue = sumByDirection(pnl.data?.byMonth, 'out', ['unpaid', 'partial'])
  const expense = sumByDirection(pnl.data?.byMonth, 'in')
  // Simetric cu "Facturat, în așteptare" de mai sus — cheltuielile recurente materializate
  // (jobs/recurring-expenses.ts) pornesc mereu unpaid, deci fără cardul ăsta ar fi invizibile
  // ca "de plată" până le marchezi manual plătite. Când se leagă reconcilierea bancară pe
  // cheltuieli (Revolut/SPV), trecerea unpaid→paid se va întâmpla automat, la fel ca la facturi.
  const pendingExpense = sumByDirection(pnl.data?.byMonth, 'in', ['unpaid', 'partial'])
  const profit = revenue != null && expense != null ? revenue - expense : null
  // Rată income/outcome — venituri încasate / cheltuieli, ambele deja convertite în aceeași monedă în SQL
  // (displayAmountSql), deci corecte indiferent de moneda cheltuielilor individuale. Cheltuieli 0 →
  // raport nedefinit (nu Infinity), afișat "—".
  const incomeOutcomeRatio = revenue != null && expense != null && expense > 0 ? revenue / expense : null

  const monthlyChartData = pivotByMonth(pnl.data?.byMonth)
  const categoryRows = pivotByCategory(pnl.data?.byCategory)

  return (
    <div className="space-y-6">
      <PageHeader title={t('common:nav.financials')} actions={<PeriodSelector />} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <KPICard label={t('financials:labels.revenueCollected')} value={revenue} unit={currency} converted={converted} isPending={pnl.isPending} />
        <KPICard label={t('financials:kpi.invoicedPending')} value={pendingRevenue} unit={currency} converted={converted} isPending={pnl.isPending} />
        <KPICard label={t('financials:labels.expenses')} value={expense} unit={currency} converted={converted} isPending={pnl.isPending} />
        <KPICard
          label={t('financials:kpi.expensesPending')}
          value={pendingExpense}
          unit={currency}
          converted={converted}
          isPending={pnl.isPending}
          hint={t('financials:kpi.expensesPendingHint')}
        />
        <KPICard
          label={t('financials:kpi.recurringMonthly')}
          value={recurringExpensesMonthly.data?.monthlyDisplay ?? null}
          unit={recurringExpensesMonthly.money?.currency ?? currency}
          converted={recurringExpensesMonthly.money?.converted}
          isPending={recurringExpensesMonthly.isPending}
          hint={t('financials:kpi.recurringMonthlyHint')}
        />
        <KPICard label={t('financials:kpi.netProfit')} value={profit} unit={currency} converted={converted} isPending={pnl.isPending} />
        <KPICard
          label={t('financials:kpi.revenueToExpenses')}
          value={incomeOutcomeRatio}
          isPending={pnl.isPending}
          tone={incomeOutcomeRatio == null ? undefined : incomeOutcomeRatio >= 1 ? 'positive' : 'negative'}
          hint={t('financials:kpi.revenueToExpensesHint')}
        />
      </div>
      <MoneyNote money={money} />

      <Card>
        <CardHeader>
          <CardTitle>{t('financials:charts.revenueVsExpenses')}</CardTitle>
        </CardHeader>
        <CardContent>
          {pnl.isPending ? (
            <ChartSkeleton height={300} />
          ) : pnl.isError ? (
            <ChartError message={t('common:states.loadFailed')} />
          ) : !monthlyChartData.length ? (
            <ChartEmpty label={t('common:states.noData')} />
          ) : (
            <MetricBarChart data={monthlyChartData} series={BAR_SERIES} unit={currency} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('financials:pnl.byCategory')}</CardTitle>
        </CardHeader>
        <CardContent>
          {pnl.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : pnl.isError ? (
            <ChartError message={t('common:states.loadFailed')} />
          ) : !categoryRows.length ? (
            <p className="text-sm text-muted-foreground">{t('financials:empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common:labels.category')}</TableHead>
                  <TableHead priority="md" className="text-right">{t('financials:labels.revenueCollected')}</TableHead>
                  <TableHead priority="md" className="text-right">{t('financials:labels.expenses')}</TableHead>
                  <TableHead className="text-right">{t('financials:labels.net')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categoryRows.map((row) => (
                  <TableRow key={row.category}>
                    <TableCell className="font-medium tbl-fill">
                      <div className="truncate capitalize">{row.category}</div>
                      <TableDetails items={[`+${approx(formatNumber(row.out, currency), money)}`, `−${approx(formatNumber(row.in, currency), money)}`]} />
                    </TableCell>
                    <TableCell priority="md" className="whitespace-nowrap text-right font-mono text-sm">{approx(formatNumber(row.out, currency), money)}</TableCell>
                    <TableCell priority="md" className="whitespace-nowrap text-right font-mono text-sm">{approx(formatNumber(row.in, currency), money)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono text-sm tnum">
                      <span className={row.out - row.in < 0 ? 'text-destructive' : undefined}>
                        {approx(formatNumber(row.out - row.in, currency), money)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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
            <p className="text-sm text-muted-foreground">{t('financials:empty')}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {cashflow.data.map((entry) => (
                <div key={`${entry.direction}-${entry.paymentStatus}`} className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">
                    {entry.direction === 'out' ? t('financials:cashFlow.issued') : t('financials:cashFlow.received')} · {CASHFLOW_LABELS[entry.paymentStatus]}
                  </div>
                  <div className="tnum font-mono text-lg font-semibold">{approx(formatNumber(entry.total, cashflow.money?.currency ?? currency), cashflow.money)}</div>
                  <div className="text-xs text-muted-foreground">{t('common:count.records', { count: entry.count })}</div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
        <div className="tnum font-mono text-2xl font-semibold">
          {latest ? `1 ${currency} = ${Number(latest.rate).toFixed(4)} ${BASE_CURRENCY}` : '—'}
          {latest && <span className="ml-2 font-sans text-sm font-normal text-muted-foreground">{t('financials:bnr.asOf', { date: latest.date })}</span>}
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
