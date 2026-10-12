import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { ChartEmpty, ChartError, ChartSkeleton } from '@/shared/components/charts/chart-states'
import { MetricBarChart } from '@/shared/components/charts/MetricBarChart'
import { KPICard } from '@/shared/components/KPICard'
import { PageHeader } from '@/shared/components/PageHeader'
import { PeriodSelector, usePeriod } from '@/shared/components/PeriodSelector'
import { api } from '@/shared/lib/api'
import { cn } from '@/shared/lib/utils'
import { CHART_NEUTRAL, chartColor } from '@/shared/lib/chart-colors'
import { formatNumber } from '@/shared/lib/format'
import type {
  ExpenseBreakdownTrendPoint,
  MonthlySnapshot,
  MrrTrendResponse,
  PeriodComparisonResponse,
} from '@/shared/lib/types'

// Convertește ?period= (7d|30d|90d|mtd|ytd) în {from,to} ISO — mirror al
// shared/lib/period.ts din backend (resolvePeriod), dar rutele /api/reports/* cer
// from/to explicit (nu period), la fel ca period-comparison care are 2 intervale simultan.
function resolvePeriodToRange(period: string): { from: string; to: string } {
  const now = new Date()
  const to = now.toISOString()
  switch (period) {
    case 'mtd':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to }
    case 'ytd':
      return { from: new Date(now.getFullYear(), 0, 1).toISOString(), to }
    case '7d':
      return { from: new Date(now.getTime() - 7 * 86400000).toISOString(), to }
    case '90d':
      return { from: new Date(now.getTime() - 90 * 86400000).toISOString(), to }
    case '30d':
    default:
      return { from: new Date(now.getTime() - 30 * 86400000).toISOString(), to }
  }
}

function monthLabel(iso: string): string {
  // iso e deja 'YYYY-MM' (TO_CHAR din backend) — afișăm direct, fără parsare Date (evită
  // ambiguitatea de fus orar pe un string fără zi).
  return iso
}

async function downloadMonthlySnapshotPdf(month: string) {
  const res = await fetch(`/api/reports/monthly-snapshot/pdf?month=${month}`, { method: 'POST', credentials: 'include' })
  if (!res.ok) throw new Error('Nu am putut genera PDF-ul (Chromium indisponibil?)')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `raport-${month}.pdf`
  link.click()
  URL.revokeObjectURL(url)
}

function MrrAndClientsSection() {
  const period = usePeriod()
  // Memoizat pe `period` — resolvePeriodToRange face `new Date().toISOString()` (precizie
  // milisecundă), care ar produce un `range` nou la FIECARE render dacă n-ar fi memoizat,
  // deci un queryKey nou → buclă infinită de refetch (a saturat rate-limit-ul global și a
  // dat senzația de delogare repetată — BUG raportat de Stefan 2026-07-21, vezi CHANGELOG).
  const range = useMemo(() => resolvePeriodToRange(period), [period])

  const mrrTrend = useQuery({
    queryKey: ['reports', 'mrr-trend', range.from, range.to],
    queryFn: () => api.get<MrrTrendResponse>(`/api/reports/mrr-trend?from=${range.from}&to=${range.to}`),
  })

  const months = [...new Set(mrrTrend.data?.clientsByMonth.map((p) => p.month) ?? [])].sort()
  const chartData = months.map((month) => {
    const active = mrrTrend.data?.clientsByMonth.find((p) => p.month === month && p.metricKey === 'active_clients')
    const demo = mrrTrend.data?.clientsByMonth.find((p) => p.month === month && p.metricKey === 'vanagreen.demo_clients')
    return { label: monthLabel(month), active: active?.value ?? 0, demo: demo?.value ?? 0 }
  })

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <KPICard label="MRR curent" value={mrrTrend.data?.currentMrr.mrrLei ?? null} unit="RON" isPending={mrrTrend.isPending} />
        <KPICard label="MRR curent (EUR)" value={mrrTrend.data?.currentMrr.mrrEur ?? null} unit="EUR" isPending={mrrTrend.isPending} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Evoluție clienți activi/demo</CardTitle>
        </CardHeader>
        <CardContent>
          {mrrTrend.isPending ? (
            <ChartSkeleton />
          ) : mrrTrend.isError ? (
            <ChartError message="Nu am putut încărca datele" />
          ) : !chartData.length ? (
            <ChartEmpty label="Nicio dată pentru această perioadă" />
          ) : (
            <MetricBarChart
              data={chartData}
              series={[
                { key: 'active', label: 'Activi', color: 'hsl(var(--primary))' },
                { key: 'demo', label: 'Demo', color: CHART_NEUTRAL },
              ]}
              unit="count"
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function PeriodComparisonSection() {
  const today = new Date().toISOString().slice(0, 10)
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const twoMonthsAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10)

  const [fromA, setFromA] = useState(twoMonthsAgo)
  const [toA, setToA] = useState(monthAgo)
  const [fromB, setFromB] = useState(monthAgo)
  const [toB, setToB] = useState(today)

  const comparison = useQuery({
    queryKey: ['reports', 'period-comparison', fromA, toA, fromB, toB],
    queryFn: () =>
      api.get<PeriodComparisonResponse>(
        `/api/reports/period-comparison?fromA=${fromA}&toA=${toA}&fromB=${fromB}&toB=${toB}`,
      ),
  })

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Comparație perioade</CardTitle>
        <Button
          variant="outline"
          onClick={() =>
            window.open(
              `/api/reports/period-comparison/csv?fromA=${fromA}&toA=${toA}&fromB=${fromB}&toB=${toB}`,
              '_blank',
            )
          }
        >
          <Download className="h-4 w-4" /> CSV
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 rounded-md bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground">Perioada A</p>
            <div className="flex flex-wrap gap-2">
              <Input type="date" value={fromA} onChange={(e) => setFromA(e.target.value)} />
              <Input type="date" value={toA} onChange={(e) => setToA(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2 rounded-md bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground">Perioada B</p>
            <div className="flex flex-wrap gap-2">
              <Input type="date" value={fromB} onChange={(e) => setFromB(e.target.value)} />
              <Input type="date" value={toB} onChange={(e) => setToB(e.target.value)} />
            </div>
          </div>
        </div>
        {comparison.isPending ? (
          <ChartSkeleton height={100} />
        ) : comparison.isError ? (
          <ChartError message="Nu am putut încărca comparația" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {(['periodA', 'periodB'] as const).map((key) => (
              <div key={key} className="space-y-1 rounded-md bg-muted/50 p-3">
                <p className="text-xs font-medium text-muted-foreground">{key === 'periodA' ? 'A' : 'B'}</p>
                <p className="text-sm">Venit: <strong className="tnum font-mono">{formatNumber(comparison.data![key].revenue, 'RON')}</strong></p>
                <p className="text-sm">Cheltuială: <strong className="tnum font-mono">{formatNumber(comparison.data![key].expense, 'RON')}</strong></p>
                <p className="text-sm">
                  Net:{' '}
                  <strong className={cn('tnum font-mono', comparison.data![key].net < 0 && 'text-destructive')}>
                    {formatNumber(comparison.data![key].net, 'RON')}
                  </strong>
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ExpenseBreakdownSection() {
  const period = usePeriod()
  const range = useMemo(() => resolvePeriodToRange(period), [period])

  const breakdown = useQuery({
    queryKey: ['reports', 'expense-breakdown-trend', range.from, range.to],
    queryFn: () =>
      api.get<ExpenseBreakdownTrendPoint[]>(`/api/reports/expense-breakdown-trend?from=${range.from}&to=${range.to}`),
  })

  const categories = [...new Set(breakdown.data?.map((p) => p.category) ?? [])]
  const months = [...new Set(breakdown.data?.map((p) => p.month) ?? [])].sort()
  const chartData = months.map((month) => {
    const row: Record<string, string | number> = { label: monthLabel(month) }
    for (const category of categories) {
      row[category] = breakdown.data?.find((p) => p.month === month && p.category === category)?.total ?? 0
    }
    return row
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cheltuieli pe categorie</CardTitle>
      </CardHeader>
      <CardContent>
        {breakdown.isPending ? (
          <ChartSkeleton />
        ) : breakdown.isError ? (
          <ChartError message="Nu am putut încărca datele" />
        ) : !chartData.length ? (
          <ChartEmpty label="Nicio cheltuială în perioadă" />
        ) : (
          <MetricBarChart
            data={chartData}
            series={categories.map((c, i) => ({ key: c, label: c, color: chartColor(i) }))}
            unit="RON"
            stacked
          />
        )}
      </CardContent>
    </Card>
  )
}

function MonthlySnapshotSection() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const [downloading, setDownloading] = useState(false)

  const snapshot = useQuery({
    queryKey: ['reports', 'monthly-snapshot', month],
    queryFn: () => api.get<MonthlySnapshot>(`/api/reports/monthly-snapshot?month=${month}`),
  })

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4">
        <CardTitle>Raport lunar</CardTitle>
        <div className="flex items-center gap-2">
          <Label htmlFor="snapshot-month" className="sr-only">Lună</Label>
          <Input id="snapshot-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
          <Button
            variant="outline"
            disabled={downloading}
            onClick={async () => {
              setDownloading(true)
              try {
                await downloadMonthlySnapshotPdf(month)
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Eroare la generarea PDF-ului')
              } finally {
                setDownloading(false)
              }
            }}
          >
            <Download className="h-4 w-4" /> {downloading ? 'Se generează…' : 'Descarcă PDF'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {snapshot.isPending ? (
          <ChartSkeleton height={120} />
        ) : snapshot.isError ? (
          <ChartError message="Nu am putut încărca raportul" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <KPICard label="Venit" value={snapshot.data?.revenue ?? null} unit="RON" />
            <KPICard label="Cheltuieli" value={snapshot.data?.expense ?? null} unit="RON" />
            <KPICard label="Net" value={snapshot.data?.net ?? null} unit="RON" />
            <KPICard label="MRR" value={snapshot.data?.mrr.mrrLei ?? null} unit="RON" />
            <KPICard label="Alerte declanșate" value={snapshot.data?.alertsTriggered ?? null} />
            <KPICard label="Rată succes sync-uri" value={snapshot.data?.syncSuccessRate ?? null} unit="%" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function ReportsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Rapoarte" actions={<PeriodSelector />} />
      <MrrAndClientsSection />
      <PeriodComparisonSection />
      <ExpenseBreakdownSection />
      <MonthlySnapshotSection />
    </div>
  )
}
