import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, ChevronLeft, ChevronRight, Search, ShieldAlert, Star, TrendingDown, TrendingUp, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader } from '@/shared/components/PageHeader'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { api } from '@/shared/lib/api'
import { useMe } from '@/shared/hooks/use-me'
import { cn, parseRoDecimal } from '@/shared/lib/utils'
import { BotTab } from './bot/BotTab'
import { MiniSparkline } from './MiniSparkline'
import { OrderDialog } from './OrderDialog'
import { formatUsd, type MarketCoin, type PaperOrderRow, type PortfolioPosition, type SearchCoin, type DexPool, type WatchEntry, type WatchPrice } from './types'
import { t } from '@/shared/lib/i18n'
import { tNodes } from '@/shared/lib/i18n-nodes'

// Pagina Crypto (PLAN.md Contract D + ajustări Stefan 2026-08-26): căutare first-class
// (CEX + DEX cu badge de rețea), stânga = Favorite + Portofoliu + Ordine recente, dreapta =
// Top market cap (25 rânduri by default, 25/50 selectabil), rânduri clickabile → pagina
// monedei. Memecoins DEX-only se urmăresc și alertează, nu se tradă pe CEX.

const CATEGORIES = [
  { key: 'all', label: t('common:labels.all') },
  { key: 'gainers', label: 'Gainers' },
  { key: 'meme-token', label: 'Memecoins' },
  { key: 'decentralized-finance-defi', label: 'DeFi' },
] as const

function ChangeCell({ change }: { change: number | null }) {
  if (change == null) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn('tnum inline-flex items-center gap-1 font-mono text-xs', change >= 0 ? 'text-success-text' : 'text-destructive-text')}>
      {change >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {change >= 0 ? '+' : ''}
      {change.toFixed(2)}%
    </span>
  )
}

interface SearchResult {
  coins: SearchCoin[]
  pools: DexPool[]
}

function SearchSection({ onAdd }: { onAdd: (entry: WatchEntry) => void }) {
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [focused, setFocused] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setFocused(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const search = useQuery({
    queryKey: ['crypto', 'search', debounced],
    queryFn: () => api.get<SearchResult>(`/api/crypto/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
  })

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder={t('crypto:search.placeholder')}
          className="pl-9"
          data-testid="crypto-search"
        />
      </div>

      {focused && debounced.length >= 2 ? (
        <div className="absolute z-20 mt-1 max-h-96 w-full overflow-y-auto rounded-md border bg-popover shadow-lg" data-testid="crypto-search-results">
          {search.isPending ? (
            <p className="p-3 text-xs text-muted-foreground">{t('common:states.searching')}</p>
          ) : !search.data || (search.data.coins.length === 0 && search.data.pools.length === 0) ? (
            <p className="p-3 text-xs text-muted-foreground">{t('crypto:search.noResult')}</p>
          ) : (
            <>
              {search.data.coins.map((coin) => (
                <button
                  key={`cex-${coin.id}`}
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    onAdd({ kind: 'cex', id: coin.id, symbol: coin.symbol, name: coin.name })
                    setFocused(false)
                  }}
                >
                  <span className="flex items-center gap-2">
                    <img src={coin.thumb} alt="" className="h-4 w-4 rounded-full" loading="lazy" />
                    <span className="font-medium">{coin.symbol}</span>
                    <span className="text-xs text-muted-foreground">{coin.name}</span>
                  </span>
                  <Badge variant="secondary">CEX</Badge>
                </button>
              ))}
              {search.data.pools.map((pool) => (
                <button
                  key={`dex-${pool.poolId}`}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    const [network] = pool.poolId.split('_')
                    onAdd({
                      kind: 'dex',
                      id: pool.poolId,
                      symbol: pool.name.split(' / ')[0] ?? pool.name,
                      name: pool.name,
                      network,
                      address: pool.address,
                      dex: pool.dex,
                    })
                    setFocused(false)
                  }}
                >
                  <span className="min-w-0">
                    <span className="font-medium">{pool.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{formatUsd(pool.priceUsd)}</span>
                  </span>
                  <Badge variant="outline" title={t('crypto:search.dexOnlyHint')}>
                    dex/{pool.network}
                  </Badge>
                </button>
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** Popover minimal pt. prag de preț — creează rând standard în alert_rules pe metrica crypto.* */
function AlertThresholdButton({ metricKey, label }: { metricKey: string; label: string }) {
  const [open, setOpen] = useState(false)
  const [threshold, setThreshold] = useState('')
  const [direction, setDirection] = useState<'gt' | 'lt'>('gt')
  const queryClient = useQueryClient()

  const create = useMutation({
    mutationFn: () =>
      api.post('/api/alert-rules', {
        name: `${label} ${direction === 'gt' ? '>' : '<'} ${threshold}$`,
        metricKey,
        condition: direction,
        threshold: parseRoDecimal(threshold),
        windowHours: 1,
        severity: 'warning',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alert-rules'] })
      toast.success(t('crypto:alert.created'))
      setOpen(false)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t('crypto:alert.create')}
        data-testid="crypto-price-alert"
        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        <Bell className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-56 space-y-2 rounded-md border bg-popover p-3 shadow-lg">
          <p className="text-xs font-medium">{t('crypto:alert.whenPrice')}</p>
          <div className="flex gap-1">
            {([['gt', t('crypto:alert.above')], ['lt', t('crypto:alert.below')]] as const).map(([cond, lbl]) => (
              <button
                key={cond}
                type="button"
                onClick={() => setDirection(cond)}
                className={cn('flex-1 rounded border px-2 py-1 text-xs', direction === cond ? 'bg-accent' : 'text-muted-foreground')}
              >
                {lbl}
              </button>
            ))}
          </div>
          <Input inputMode="decimal" placeholder={t('crypto:alert.thresholdPlaceholder')} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          <Button className="w-full" disabled={!parseRoDecimal(threshold) || create.isPending} onClick={() => create.mutate()}>
            {t('common:actions.create')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function CryptoPage() {
  const navigate = useNavigate()
  const { can } = useMe()
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Number(searchParams.get('page') ?? '1') || 1
  const category = searchParams.get('category') ?? 'all'
  const limit = searchParams.get('limit') === '50' ? 50 : 25
  // Tabul „Bot" e funcționalitatea `investitii.bots` (doar Vanadium) — fără ea rămâne Piața,
  // chiar dacă cineva intră pe linkul cu ?tab=bot.
  const seesBot = can('investitii.bots')
  const tab = seesBot && searchParams.get('tab') === 'bot' ? 'bot' : 'piata'
  const [orderSymbol, setOrderSymbol] = useState<string | null>(null)

  function setPageParams(next: { page?: number; category?: string; limit?: number }) {
    setSearchParams({
      page: String(next.page ?? page),
      category: next.category ?? category,
      limit: String(next.limit ?? limit),
    })
  }

  const queryClient = useQueryClient()
  const watchPrices = useQuery({
    queryKey: ['crypto', 'watchlist-prices'],
    queryFn: () => api.get<WatchPrice[]>('/api/crypto/watchlist/prices'),
    refetchInterval: 60_000,
  })

  const markets = useQuery({
    queryKey: ['crypto', 'markets', page, category, limit],
    queryFn: () =>
      api.get<{ coins: MarketCoin[]; totalPages: number | null }>(
        `/api/crypto/markets?page=${page}&category=${encodeURIComponent(category)}&limit=${limit}`,
      ),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  })

  const settings = useQuery({
    queryKey: ['crypto', 'settings'],
    queryFn: () => api.get<{ tradingEnabled: boolean }>('/api/crypto/settings'),
  })

  const portfolio = useQuery({
    queryKey: ['crypto', 'portfolio'],
    queryFn: () => api.get<{ positions: PortfolioPosition[]; realizedPnlUsd: number }>('/api/crypto/portfolio'),
    staleTime: 60_000,
  })

  const orders = useQuery({
    queryKey: ['crypto', 'orders'],
    queryFn: () => api.get<PaperOrderRow[]>('/api/crypto/orders'),
    staleTime: 60_000,
  })

  function toggleWatchlist(entry: WatchEntry, present: boolean) {
    const mutation = present
      ? api.delete(`/api/crypto/watchlist/${entry.kind}/${encodeURIComponent(entry.id)}`)
      : api.post('/api/crypto/watchlist', entry)
    void mutation
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ['crypto', 'watchlist-prices'] })
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : String(err)))
  }

  function isWatched(kind: WatchEntry['kind'], id: string): boolean {
    return watchPrices.data?.some((w) => w.entry.kind === kind && w.entry.id === id) ?? false
  }

  const totalValueUsd = portfolio.data?.positions.reduce((sum, p) => sum + (p.valueUsd ?? 0), 0) ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('common:nav.crypto')}
        actions={
          settings.data?.tradingEnabled ? (
            <Badge variant="destructive" className="gap-1">
              <ShieldAlert className="h-3 w-3" /> {t('crypto:mode.live')}
            </Badge>
          ) : (
            <Badge variant="secondary">{t('crypto:mode.paper')}</Badge>
          )
        }
      />

      <Tabs value={tab} onValueChange={(next) => setSearchParams(next === 'bot' ? { tab: 'bot' } : {})}>
        <TabsList>
          <TabsTrigger value="piata">{t('crypto:tabs.market')}</TabsTrigger>
          {seesBot && <TabsTrigger value="bot">{t('crypto:tabs.bot')}</TabsTrigger>}
        </TabsList>
        {seesBot && (
          <TabsContent value="bot">
            <BotTab />
          </TabsContent>
        )}
        <TabsContent value="piata" className="space-y-6">
          <SearchSection
            onAdd={(entry) => {
              toggleWatchlist(entry, isWatched(entry.kind, entry.id))
            }}
          />

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            {/* ── Stânga: Favorite + Portofoliu + Ordine recente ── */}
            <div className="min-w-0 space-y-6">
              <section className="space-y-2" data-testid="crypto-watchlist">
                <h2 className="text-sm font-semibold">{t('crypto:favorites.title')}</h2>
                {watchPrices.isPending ? (
                  <Skeleton className="h-24 w-full" />
                ) : !watchPrices.data?.length ? (
                  <Card>
                    <CardContent className="pt-6 text-sm text-muted-foreground">
                      {t('crypto:favorites.empty')}
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                    {watchPrices.data.map(({ entry, priceUsd, change24h, sparkline }) => (
                      <Card
                        key={`${entry.kind}:${entry.id}`}
                        className={cn('py-2.5', entry.kind === 'cex' && 'cursor-pointer transition-colors hover:bg-accent/40')}
                        onClick={entry.kind === 'cex' ? () => void navigate(`/crypto/coin/${entry.id}`) : undefined}
                      >
                        {/* două rânduri fixe — sparkline-ul nu poate suprapune textul pe coloane înguste */}
                        <CardContent className="space-y-1 px-3 pt-0 max-sm:px-3">
                          <div className="flex items-center justify-between gap-1">
                            <p className="min-w-0 truncate text-sm font-medium" title={entry.name}>
                              {entry.symbol}
                              {entry.kind === 'dex' && entry.network ? (
                                <Badge variant="outline" className="ml-1.5">
                                  dex/{entry.network}
                                </Badge>
                              ) : null}
                            </p>
                            <div className="flex shrink-0 items-center gap-0.5">
                              <AlertThresholdButton metricKey={entry.kind === 'cex' ? `crypto.${entry.id}` : `crypto.dex.${entry.id}`} label={entry.symbol} />
                              <button
                                type="button"
                                aria-label={t('crypto:favorites.remove')}
                                className="rounded p-1 hover:bg-accent"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleWatchlist(entry, true)
                                }}
                              >
                                <X className="h-3.5 w-3.5 text-muted-foreground" />
                              </button>
                            </div>
                          </div>
                          <div className="flex items-end justify-between gap-2">
                            <div className="min-w-0">
                              <p className="tnum font-mono text-sm leading-tight">{formatUsd(priceUsd)}</p>
                              <ChangeCell change={change24h} />
                            </div>
                            <MiniSparkline values={sparkline} width={88} height={24} />
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </section>

              <Card>
                <CardContent className="pt-6">
                  <div className="mb-2 flex items-baseline justify-between">
                    <h2 className="text-sm font-semibold">{t('crypto:portfolio.title')}</h2>
                    <span className="tnum font-mono text-sm">{formatUsd(totalValueUsd)}</span>
                  </div>
                  {portfolio.isPending ? (
                    <Skeleton className="h-32 w-full" />
                  ) : !portfolio.data?.positions.length ? (
                    <p className="text-sm text-muted-foreground">
                      {t('crypto:portfolio.empty')}
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('crypto:portfolio.asset')}</TableHead>
                          <TableHead priority="md">{t('common:labels.quantity')}</TableHead>
                          <TableHead className="text-right">{t('common:labels.value')}</TableHead>
                          <TableHead className="text-right">P&L</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {portfolio.data.positions.map((pos) => (
                          <TableRow key={`${pos.source}-${pos.asset}`}>
                            <TableCell className="font-medium">
                              {pos.asset} <Badge variant="outline" className="ml-1">{pos.source}</Badge>
                            <TableDetails items={[String(Number(pos.qty.toPrecision(6)))]} />
                            </TableCell>
                            <TableCell priority="md" className="whitespace-nowrap text-xs tabular-nums">{Number(pos.qty.toPrecision(6))}</TableCell>
                            <TableCell className="whitespace-nowrap text-right text-xs tabular-nums">{formatUsd(pos.valueUsd)}</TableCell>
                            <TableCell className="text-right">
                              {pos.unrealizedPnlUsd != null ? (
                                <span className={cn('tnum font-mono text-xs', pos.unrealizedPnlUsd >= 0 ? 'text-success-text' : 'text-destructive-text')}>
                                  {pos.unrealizedPnlUsd >= 0 ? '+' : ''}
                                  {formatUsd(pos.unrealizedPnlUsd)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  {(portfolio.data?.realizedPnlUsd ?? 0) !== 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {tNodes('crypto:portfolio.realizedPnl', {
                        value: (
                          <span className={cn('tnum font-mono', (portfolio.data?.realizedPnlUsd ?? 0) >= 0 ? 'text-success-text' : 'text-destructive-text')}>
                            {formatUsd(portfolio.data?.realizedPnlUsd)}
                          </span>
                        ),
                      })}
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="pt-6">
                  <h2 className="mb-2 text-sm font-semibold">{t('crypto:orders.recent')}</h2>
                  {!orders.data?.length ? (
                    <p className="text-sm text-muted-foreground">{t('crypto:orders.none')}</p>
                  ) : (
                    <ul className="space-y-1.5 font-mono text-xs" data-testid="crypto-orders-list">
                      {orders.data.slice(0, 10).map((order) => (
                        <li key={order.id} className="flex items-center justify-between gap-2 border-b pb-1 last:border-none">
                          <span>
                            <span className={order.side === 'buy' ? 'text-success-text' : 'text-destructive-text'}>
                              {order.side === 'buy' ? 'BUY' : 'SELL'}
                            </span>{' '}
                            {Number(order.quantity).toPrecision(6)} {order.symbol}
                          </span>
                          <span className="text-muted-foreground">
                            {order.executedPrice ? `${formatUsd(Number(order.executedPrice))}` : order.status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* ── Dreapta: Top market cap ── */}
            <section className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{t('crypto:market.topMarketCap')}</h2>
                <div className="flex flex-wrap items-center gap-1">
                  <div className="mr-1 flex gap-1">
                    {[25, 50].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setPageParams({ page: 1, limit: n })}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-xs transition-colors',
                          limit === n ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent',
                        )}
                        title={t('crypto:market.perPage', { n })}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  {CATEGORIES.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setPageParams({ page: 1, category: c.key })}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs transition-colors',
                        category === c.key ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent',
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <Card>
                <CardContent className="pt-0">
                  {markets.isPending ? (
                    <Skeleton className="h-72 w-full" />
                  ) : markets.isError ? (
                    <p className="pt-6 text-sm text-destructive">{(markets.error as Error).message}</p>
                  ) : !markets.data?.coins.length ? (
                    <p className="pt-6 text-sm text-muted-foreground">{t('crypto:market.emptyCategory')}</p>
                  ) : (
                    <>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-8" />
                            <TableHead>{t('crypto:market.coin')}</TableHead>
                            <TableHead className="text-right">{t('common:labels.price')}</TableHead>
                            <TableHead className="text-right">24h</TableHead>
                            <TableHead className="hidden text-right lg:table-cell">{t('crypto:stats.marketCap')}</TableHead>
                            <TableHead className="hidden md:table-cell">{t('common:labels.days7')}</TableHead>
                            <TableHead priority="md" className="text-right">{t('common:labels.order')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {markets.data.coins.map((coin) => (
                            <TableRow
                              key={coin.id}
                              className="cursor-pointer"
                              onClick={() => void navigate(`/crypto/coin/${coin.id}`)}
                              data-testid="crypto-market-row"
                            >
                              <TableCell>
                                <button
                                  type="button"
                                  aria-label={isWatched('cex', coin.id) ? t('crypto:favorites.remove') : t('crypto:favorites.add')}
                                  className="rounded p-0.5 hover:bg-accent"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    toggleWatchlist({ kind: 'cex', id: coin.id, symbol: coin.symbol, name: coin.name }, isWatched('cex', coin.id))
                                  }}
                                >
                                  <Star className={cn('h-3.5 w-3.5', isWatched('cex', coin.id) ? 'fill-warning text-warning' : 'text-muted-foreground')} />
                                </button>
                              </TableCell>
                              <TableCell>
                                <span className="font-medium uppercase">{coin.symbol}</span>
                                <span className="ml-2 text-xs text-muted-foreground tbl-md">{coin.name}</span>
                              </TableCell>
                              <TableCell className="tnum text-right font-mono text-xs">{formatUsd(coin.priceUsd)}</TableCell>
                              <TableCell className="text-right">
                                <ChangeCell change={coin.change24h} />
                              </TableCell>
                              <TableCell className="tnum hidden text-right font-mono text-xs lg:table-cell">
                                {formatUsd(coin.marketCapUsd)}
                              </TableCell>
                              <TableCell className="hidden md:table-cell">
                                <MiniSparkline values={coin.sparkline} width={80} height={22} />
                              </TableCell>
                              <TableCell priority="md" className="text-right">
                                <Button
                                  variant="outline"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setOrderSymbol(`${coin.symbol}USDT`)
                                  }}
                                  title={t('crypto:order.orderOn', { symbol: coin.symbol })}
                                >
                                  {t('common:labels.order')}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <div className="flex items-center justify-between border-t p-2">
                        <Button variant="ghost" disabled={page <= 1} onClick={() => setPageParams({ page: Math.max(1, page - 1) })}>
                          <ChevronLeft className="h-4 w-4" /> {t('crypto:market.previous')}
                        </Button>
                        <span className="tnum text-xs text-muted-foreground">{markets.data.totalPages ? t('crypto:market.pageOf', { page, total: markets.data.totalPages }) : t('crypto:market.page', { page })}</span>
                        <Button variant="ghost" disabled={markets.data.coins.length === 0 || page >= 20} onClick={() => setPageParams({ page: page + 1 })}>
                          {t('crypto:market.next')} <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </section>
          </div>
        </TabsContent>
      </Tabs>

      <OrderDialog open={orderSymbol !== null} onOpenChange={(open) => { if (!open) setOrderSymbol(null) }} defaultSymbol={orderSymbol ?? ''} />
    </div>
  )
}
