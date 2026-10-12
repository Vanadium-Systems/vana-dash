import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { KPICard } from '@/shared/components/KPICard'
import { PageHeader } from '@/shared/components/PageHeader'
import { PeriodSelector, usePeriod } from '@/shared/components/PeriodSelector'
import { ChartEmpty, ChartError, ChartSkeleton } from '@/shared/components/charts/chart-states'
import { MetricBarChart } from '@/shared/components/charts/MetricBarChart'
import { api } from '@/shared/lib/api'
import { sumByDirection } from '@/shared/lib/financial-utils'
import type { CashflowEntry, ExchangeRatePoint, PnlByCategory, PnlByMonth, PnlResponse } from '@/shared/lib/types'
import { formatNumber } from '@/shared/lib/utils'
import { BnrRateChart, type BnrRatePoint } from './BnrRateChart'

const BAR_SERIES = [
  { key: 'out', label: 'Venituri (încasate)', color: 'hsl(var(--primary))' },
  { key: 'in', label: 'Cheltuieli', color: 'hsl(var(--destructive))' },
]

const CASHFLOW_LABELS: Record<CashflowEntry['paymentStatus'], string> = {
  paid: 'Plătit',
  partial: 'Parțial plătit',
  unpaid: 'Neplătit',
}

export function FinancialsPage() {
  const period = usePeriod()

  const pnl = useQuery({
    queryKey: ['financials', 'pnl', period],
    queryFn: () => api.get<PnlResponse>(`/api/financials/pnl?period=${period}`),
  })
  const cashflow = useQuery({
    queryKey: ['financials', 'cashflow', period],
    queryFn: () => api.get<CashflowEntry[]>(`/api/financials/cashflow?period=${period}`),
  })
  // Calculat LIVE din recurring_expenses, nu din financial_records — o cheltuială recurentă abia
  // creată n-are încă niciun rând materializat (cron-ul scrie unul doar la nextDueDate), deci
  // fără query-ul ăsta separat ar fi invizibilă pe Financials până la următoarea rulare de cron.
  const recurringExpensesMonthly = useQuery({
    queryKey: ['financials', 'recurring-expenses'],
    queryFn: () => api.get<{ monthlyRon: number }>('/api/financials/recurring-expenses'),
  })

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
  // Rată income/outcome — venituri încasate / cheltuieli, ambele deja convertite la RON în SQL
  // (ronAmountSql), deci corecte indiferent de moneda cheltuielilor individuale. Cheltuieli 0 →
  // raport nedefinit (nu Infinity), afișat "—".
  const incomeOutcomeRatio = revenue != null && expense != null && expense > 0 ? revenue / expense : null

  const monthlyChartData = pivotByMonth(pnl.data?.byMonth)
  const categoryRows = pivotByCategory(pnl.data?.byCategory)

  return (
    <div className="space-y-6">
      <PageHeader title="Financiar" actions={<PeriodSelector />} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        <KPICard label="Venituri (încasate)" value={revenue} unit="RON" isPending={pnl.isPending} />
        <KPICard label="Facturat, în așteptare" value={pendingRevenue} unit="RON" isPending={pnl.isPending} />
        <KPICard label="Cheltuieli" value={expense} unit="RON" isPending={pnl.isPending} />
        <KPICard
          label="Cheltuieli, în așteptare"
          value={pendingExpense}
          unit="RON"
          isPending={pnl.isPending}
          hint="deja materializate, neplătite"
        />
        <KPICard
          label="Cheltuieli recurente (lunar)"
          value={recurringExpensesMonthly.data?.monthlyRon ?? null}
          unit="RON"
          isPending={recurringExpensesMonthly.isPending}
          hint="abonamentele active, echivalent lunar"
        />
        <KPICard label="Profit net" value={profit} unit="RON" isPending={pnl.isPending} />
        <KPICard
          label="Venituri / cheltuieli"
          value={incomeOutcomeRatio}
          isPending={pnl.isPending}
          tone={incomeOutcomeRatio == null ? undefined : incomeOutcomeRatio >= 1 ? 'positive' : 'negative'}
          hint="încasat raportat la cheltuit"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Venituri (încasate) vs. cheltuieli pe lună</CardTitle>
        </CardHeader>
        <CardContent>
          {pnl.isPending ? (
            <ChartSkeleton height={300} />
          ) : pnl.isError ? (
            <ChartError message="Nu am putut încărca datele" />
          ) : !monthlyChartData.length ? (
            <ChartEmpty label="Nicio dată pentru această perioadă" />
          ) : (
            <MetricBarChart data={monthlyChartData} series={BAR_SERIES} unit="RON" />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>P&L pe categorie</CardTitle>
        </CardHeader>
        <CardContent>
          {pnl.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : pnl.isError ? (
            <ChartError message="Nu am putut încărca datele" />
          ) : !categoryRows.length ? (
            <p className="text-sm text-muted-foreground">Nicio înregistrare în această perioadă.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Categorie</TableHead>
                  <TableHead className="text-right">Venituri (încasate)</TableHead>
                  <TableHead className="text-right">Cheltuieli</TableHead>
                  <TableHead className="text-right">Net</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categoryRows.map((row) => (
                  <TableRow key={row.category}>
                    <TableCell className="font-medium capitalize">{row.category}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatNumber(row.out, 'RON')}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatNumber(row.in, 'RON')}</TableCell>
                    <TableCell className="text-right font-mono text-sm tnum">
                      <span className={row.out - row.in < 0 ? 'text-destructive' : undefined}>
                        {formatNumber(row.out - row.in, 'RON')}
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
          <CardTitle>Cash flow</CardTitle>
        </CardHeader>
        <CardContent>
          {cashflow.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : cashflow.isError ? (
            <ChartError message="Nu am putut încărca datele" />
          ) : !cashflow.data?.length ? (
            <p className="text-sm text-muted-foreground">Nicio înregistrare în această perioadă.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {cashflow.data.map((entry) => (
                <div key={`${entry.direction}-${entry.paymentStatus}`} className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">
                    {entry.direction === 'out' ? 'Emise' : 'Primite'} · {CASHFLOW_LABELS[entry.paymentStatus]}
                  </div>
                  <div className="tnum font-mono text-lg font-semibold">{formatNumber(entry.total, 'RON')}</div>
                  <div className="text-xs text-muted-foreground">{entry.count} înregistrări</div>
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
  ['week', 'Săptămâna'],
  ['month', 'Luna'],
  ['year', 'Anul'],
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
        <CardTitle>Curs BNR</CardTitle>
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
          {latest ? `1 ${currency} = ${Number(latest.rate).toFixed(4)} RON` : '—'}
          {latest && <span className="ml-2 font-sans text-sm font-normal text-muted-foreground">la {latest.date}</span>}
        </div>
        {history.isPending ? (
          <ChartSkeleton height={220} />
        ) : history.isError ? (
          <ChartError message="Nu am putut încărca cursul BNR" />
        ) : !chartData.length ? (
          <ChartEmpty label="Niciun curs istoric încă — jobs/bnr-daily-fetch.ts abia a pornit" />
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
      label: new Date(row.month).toLocaleDateString('ro-RO', { month: 'short', year: '2-digit' }),
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
