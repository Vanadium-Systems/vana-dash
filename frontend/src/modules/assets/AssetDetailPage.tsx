import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CandlestickChart, Star } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { PageHeader } from '@/shared/components/PageHeader'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { api } from '@/shared/lib/api'
import { cn } from '@/shared/lib/utils'
import { CandleChart } from '@/modules/crypto/CandleChart'
import { OrderDialog } from './OrderDialog'
import { CATEGORY_LABEL, formatUsd, type AssetCategory, type AssetDetail, type ChartBar, type WatchEntry } from './types'
import { intlTag } from '@/shared/lib/format'

// Pagina unui simbol (cerință Stefan: „cum e pe Crypto") — schelet identic CoinDetailPage:
// grafic cu intervale + candele, statistici, favorite + ordin direct de aici. Graficul vine din
// Twelve Data pt. AMBELE categorii (Finnhub blochează candelele istorice pe tier gratuit,
// verificat live) — cotația curentă rămâne Finnhub pt. acțiuni/ETF-uri. Fără „descriere" gen
// Crypto (Finnhub n-are text liber pe free) — profilul companiei (industrie, bursă, IPO) e cel
// mai apropiat echivalent onest.

const RANGES = [
  { days: 1, label: '24h' },
  { days: 7, label: '7 zile' },
  { days: 30, label: '30 zile' },
  { days: 90, label: '90 zile' },
  { days: 365, label: '1 an' },
] as const

function ChangePct({ value, label }: { value: number | null; label: string }) {
  if (value == null) return null
  return (
    <span className={cn('tnum font-mono text-xs', value >= 0 ? 'text-success-text' : 'text-destructive-text')}>
      {label} {value >= 0 ? '+' : ''}
      {value.toFixed(2)}%
    </span>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="tnum mt-0.5 font-mono text-sm">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  )
}

function formatCompact(value: number | null): string {
  if (value == null) return '—'
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}B$`
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}M$`
  if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}K$`
  return formatUsd(value)
}

export function AssetDetailPage() {
  const { category = 'stock', symbol = '' } = useParams<{ category: AssetCategory; symbol: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [days, setDays] = useState<1 | 7 | 30 | 90 | 365>(30)
  const [chartMode, setChartMode] = useState<'line' | 'candles'>('line')
  const [orderOpen, setOrderOpen] = useState(false)

  const detail = useQuery({
    queryKey: ['assets', 'detail', category, symbol],
    queryFn: () => api.get<AssetDetail>(`/api/assets/detail/${category}/${encodeURIComponent(symbol)}`),
    staleTime: 60_000,
  })

  const chart = useQuery({
    queryKey: ['assets', 'detail-chart', category, symbol, days],
    queryFn: () => api.get<{ bars: ChartBar[] }>(`/api/assets/detail/${category}/${encodeURIComponent(symbol)}/chart?days=${days}`),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  })

  const watchlist = useQuery({
    queryKey: ['assets', 'watchlist'],
    queryFn: () => api.get<WatchEntry[]>('/api/assets/watchlist'),
    staleTime: 60_000,
  })

  const brokers = useQuery({
    queryKey: ['assets', 'brokers'],
    queryFn: () => api.get<Array<{ broker: string; mode: 'paper' | 'live' }>>('/api/assets/brokers'),
    staleTime: 60_000,
  })
  const t212Mode = brokers.data?.find((b) => b.broker === 'trading212')?.mode ?? 'paper'

  const toggleWatch = useMutation({
    mutationFn: (present: boolean) =>
      present
        ? api.delete(`/api/assets/watchlist/${category}/${encodeURIComponent(symbol)}`)
        : api.post('/api/assets/watchlist', { category, symbol, name: detail.data?.name ?? symbol }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['assets'] }),
    onError: (err) => toast.error(err.message),
  })

  if (detail.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  if (detail.isError || !detail.data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => void navigate('/assets')}>
          <ArrowLeft className="h-4 w-4" /> Înapoi la Assets
        </Button>
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">
            Nu am putut încărca {symbol}: {(detail.error as Error | undefined)?.message ?? 'inexistent'}
          </CardContent>
        </Card>
      </div>
    )
  }

  const a = detail.data
  const watched = watchlist.data?.some((w) => w.category === category && w.symbol === symbol) ?? false
  const bars = chart.data?.bars ?? []
  const chartData = bars.map((b) => ({
    ...b,
    label: new Date(b.t).toLocaleString(intlTag(), { day: 'numeric', month: 'short', hour: days <= 7 ? '2-digit' : undefined, minute: days <= 7 ? '2-digit' : undefined }),
  }))
  const first = chartData[0]?.c
  const last = chartData.at(-1)?.c
  const rangeUp = first != null && last != null ? last >= first : true

  return (
    <div className="space-y-6">
      <PageHeader
        title=""
        actions={
          <>
            <Button variant="outline" onClick={() => toggleWatch.mutate(watched)} disabled={toggleWatch.isPending}>
              <Star className={cn('h-4 w-4', watched && 'fill-warning text-warning')} />
              {watched ? 'În favorite' : 'Adaugă la favorite'}
            </Button>
            <Button onClick={() => setOrderOpen(true)}>
              Ordin {symbol}
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => void navigate('/assets')} aria-label="Înapoi">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {a.logoUrl ? <img src={a.logoUrl} alt="" className="h-8 w-8 rounded-full" /> : null}
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            {a.name}
            <span className="font-mono text-sm uppercase text-muted-foreground">{a.symbol}</span>
          </h1>
          <p className="flex items-baseline gap-3">
            <span className="tnum font-mono text-lg">{formatUsd(a.priceUsd)}</span>
            <ChangePct value={a.changePct} label="azi" />
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className={cn('tnum font-mono text-xs', rangeUp ? 'text-success-text' : 'text-destructive-text')}>
                {first != null && last != null ? `${(((last - first) / first) * 100).toFixed(2)}% în interval` : '—'}
              </span>
              <div className="flex gap-1">
                {([['line', 'Linie'], ['candles', 'Candele']] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setChartMode(mode)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors',
                      chartMode === mode ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent',
                    )}
                  >
                    {mode === 'candles' ? <CandlestickChart className="h-3 w-3" /> : null}
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-1">
              {RANGES.map((r) => (
                <button
                  key={r.days}
                  type="button"
                  onClick={() => setDays(r.days)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors',
                    days === r.days ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {chartMode === 'candles' ? (
            chart.isPending && !bars.length ? <Skeleton className="h-72 w-full" /> : <CandleChart candles={bars} height={320} />
          ) : chart.isPending && !chartData.length ? (
            <Skeleton className="h-72 w-full" />
          ) : chartData.length < 2 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              Grafic indisponibil — verifică cheia Twelve Data din Setări.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="asset-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={48} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={70} tickFormatter={(v: number) => formatUsd(v)} />
                <Tooltip
                  formatter={(v) => [formatUsd(Number(v)), a.symbol]}
                  contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, color: 'hsl(var(--card-foreground))' }}
                />
                <Area type="monotone" dataKey="c" stroke={rangeUp ? 'hsl(var(--success-text))' : 'hsl(var(--destructive-text))'} strokeWidth={2} fill="url(#asset-fill)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Deschidere" value={formatUsd(a.open)} />
        <Stat label="Maxim" value={formatUsd(a.high)} />
        <Stat label="Minim" value={formatUsd(a.low)} />
        <Stat label="Închidere anterioară" value={formatUsd(a.previousClose)} />
        {a.category !== 'metal' ? (
          <>
            <Stat label="Market cap" value={formatCompact(a.marketCapUsd)} />
            <Stat label="Acțiuni în circulație" value={a.sharesOutstanding?.toLocaleString(intlTag(), { maximumFractionDigits: 0 }) ?? '—'} />
            <Stat label="Bursă" value={a.exchange ?? '—'} />
            <Stat label="IPO" value={a.ipoDate ?? '—'} />
          </>
        ) : null}
      </div>

      {a.category !== 'metal' && (a.industry || a.websiteUrl) ? (
        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-2 text-sm font-semibold">Profil {a.name}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {a.industry ? <>Industrie: {a.industry}. </> : null}
              {CATEGORY_LABEL[a.category]}
              {a.websiteUrl ? (
                <>
                  {' — '}
                  <a href={a.websiteUrl} target="_blank" rel="noreferrer" className="underline">
                    {a.websiteUrl.replace(/^https?:\/\//, '')}
                  </a>
                </>
              ) : null}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <OrderDialog open={orderOpen} onOpenChange={setOrderOpen} defaultSymbol={symbol} liveMode={t212Mode === 'live'} />
    </div>
  )
}
