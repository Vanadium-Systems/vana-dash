import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CandlestickChart, Star } from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'
import { PageHeader } from '@/shared/components/PageHeader'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { api } from '@/shared/lib/api'
import { cn } from '@/shared/lib/utils'
import { CandleChart } from './CandleChart'
import { OrderDialog } from './OrderDialog'
import { formatUsd, type ChartPoint, type CoinDetails, type WatchEntry } from './types'

// Pagina unei monede (cerință Stefan: „cum e pe Binance") — grafic cu intervale, statistici
// complete din /coins/{id}, descriere, favorite + ordin direct de aici.

const RANGES = [
  { days: 1, label: '24h' },
  { days: 7, label: '7 zile' },
  { days: 30, label: '30 zile' },
  { days: 90, label: '90 zile' },
  { days: 365, label: '1 an' },
] as const

export interface CandlesResponse {
  candles: Array<{ t: number; o: number; h: number; l: number; c: number }>
}

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

export function CoinDetailPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [days, setDays] = useState<1 | 7 | 30 | 90 | 365>(7)
  const [chartMode, setChartMode] = useState<'line' | 'candles'>('line')
  const [orderSymbol, setOrderSymbol] = useState<string | null>(null)

  const details = useQuery({
    queryKey: ['crypto', 'coin', id],
    queryFn: () => api.get<CoinDetails>(`/api/crypto/coin/${id}`),
    staleTime: 60_000,
  })

  const chart = useQuery({
    queryKey: ['crypto', 'coin-chart', id, days],
    queryFn: () => api.get<{ points: ChartPoint[] }>(`/api/crypto/coin/${id}/chart?days=${days}`),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  })

  // Candelele se încarcă doar când modul e activ — economisim un apel CoinGecko pe view.
  const candlesQuery = useQuery<CandlesResponse>({
    queryKey: ['crypto', 'coin-candles', id, days],
    queryFn: () => api.get<CandlesResponse>(`/api/crypto/coin/${id}/candles?days=${days}`),
    staleTime: 60_000,
    enabled: chartMode === 'candles',
  })

  const watchlist = useQuery({
    queryKey: ['crypto', 'watchlist'],
    queryFn: () => api.get<WatchEntry[]>('/api/crypto/watchlist'),
    staleTime: 60_000,
  })

  const toggleWatch = useMutation({
    mutationFn: (present: boolean) =>
      present
        ? api.delete(`/api/crypto/watchlist/cex/${encodeURIComponent(id)}`)
        : api.post('/api/crypto/watchlist', {
            kind: 'cex',
            id,
            symbol: details.data?.symbol ?? id,
            name: details.data?.name ?? id,
          }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['crypto'] })
    },
    onError: (err) => toast.error(err.message),
  })

  if (details.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  if (details.isError || !details.data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => void navigate('/crypto')}>
          <ArrowLeft className="h-4 w-4" /> Înapoi la Crypto
        </Button>
        <Card>
          <CardContent className="pt-6 text-sm text-destructive">
            Nu am putut încărca moneda: {(details.error as Error | undefined)?.message ?? 'inexistentă'}
          </CardContent>
        </Card>
      </div>
    )
  }

  const coin = details.data
  const watched = watchlist.data?.some((w) => w.kind === 'cex' && w.id === id) ?? false
  const chartData = (chart.data?.points ?? []).map((p) => ({ ...p, label: new Date(p.t).toLocaleString('ro-RO', { day: 'numeric', month: 'short', hour: days === 1 ? '2-digit' : undefined, minute: days === 1 ? '2-digit' : undefined }) }))
  const first = chartData[0]?.p
  const last = chartData.at(-1)?.p
  const rangeUp = first != null && last != null ? last >= first : true
  const binanceSymbol = `${coin.symbol}USDT`

  return (
    <div className="space-y-6">
      <PageHeader
        title=""
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => toggleWatch.mutate(watched)}
              disabled={toggleWatch.isPending}
            >
              <Star className={cn('h-4 w-4', watched && 'fill-warning text-warning')} />
              {watched ? 'În favorite' : 'Adaugă la favorite'}
            </Button>
            <Button onClick={() => setOrderSymbol(binanceSymbol)}>
              Ordin {binanceSymbol}
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => void navigate('/crypto')} aria-label="Înapoi">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {coin.image ? <img src={coin.image} alt="" className="h-8 w-8 rounded-full" /> : null}
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            {coin.name}
            <span className="font-mono text-sm uppercase text-muted-foreground">{coin.symbol}</span>
            {coin.rank ? <Badge variant="secondary">#{coin.rank}</Badge> : null}
          </h1>
          <p className="flex items-baseline gap-3">
            <span className="tnum font-mono text-lg">{formatUsd(coin.priceUsd)}</span>
            <ChangePct value={coin.change24h} label="24h" />
            <ChangePct value={coin.change7d} label="7z" />
            <ChangePct value={coin.change30d} label="30z" />
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
            // Fără isPending în condiție — discriminantul v5.59 narrowează data la never în
            // ramura pending și pică accesul `.candles`; data undefined → skeleton, la fel.
            !candlesQuery.data?.candles.length ? (
              <Skeleton className="h-72 w-full" />
            ) : (
              <CandleChart candles={candlesQuery.data.candles} height={320} />
            )
          ) : chart.isPending && !chartData.length ? (
            <Skeleton className="h-72 w-full" />
          ) : chartData.length < 2 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Grafic indisponibil momentan.</p>
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="coin-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={48} />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={70}
                  tickFormatter={(v: number) => formatUsd(v)}
                />
                <Tooltip
                  formatter={(v) => [formatUsd(Number(v)), coin.symbol]}
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 6,
                    color: 'hsl(var(--card-foreground))',
                  }}
                />
                <Area type="monotone" dataKey="p" stroke={rangeUp ? 'hsl(var(--success-text))' : 'hsl(var(--destructive-text))'} strokeWidth={2} fill="url(#coin-fill)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Market cap" value={formatCompact(coin.marketCapUsd)} />
        <Stat label="Volum 24h" value={formatCompact(coin.volume24hUsd)} />
        <Stat label="Supply circulant" value={coin.circulatingSupply?.toLocaleString('ro-RO', { maximumFractionDigits: 0 }) ?? '—'} sub={coin.maxSupply ? `max ${coin.maxSupply.toLocaleString('ro-RO', { maximumFractionDigits: 0 })}` : coin.totalSupply ? `total ${coin.totalSupply.toLocaleString('ro-RO', { maximumFractionDigits: 0 })}` : null} />
        <Stat label="ATH" value={formatUsd(coin.athUsd)} sub={coin.athDate ? new Date(coin.athDate).toLocaleDateString('ro-RO') : null} />
        <Stat label="ATL" value={formatUsd(coin.atlUsd)} sub={coin.atlDate ? new Date(coin.atlDate).toLocaleDateString('ro-RO') : null} />
        <Stat label="Față de ATH" value={coin.athChangePct != null ? `${coin.athChangePct.toFixed(1)}%` : '—'} />
        <Stat label="Față de ATL" value={coin.atlChangePct != null ? `+${coin.atlChangePct.toFixed(1)}%` : '—'} />
        <Stat label="Pereche Binance" value={binanceSymbol} sub="butonul Ordin deschide formularul" />
      </div>

      {coin.description ? (
        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-2 text-sm font-semibold">Despre {coin.name}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">{coin.description}</p>
          </CardContent>
        </Card>
      ) : null}

      <OrderDialog open={orderSymbol !== null} onOpenChange={(open) => { if (!open) setOrderSymbol(null) }} defaultSymbol={orderSymbol ?? ''} />
    </div>
  )
}
