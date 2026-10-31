import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search, ShieldAlert, Star, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader } from '@/shared/components/PageHeader'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Alert } from '@/shared/components/ui/alert'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { api } from '@/shared/lib/api'
import { useMe } from '@/shared/hooks/use-me'
import { cn } from '@/shared/lib/utils'
import { MiniSparkline } from '@/modules/crypto/MiniSparkline'
import { StocksBotTab } from './bot/StocksBotTab'
import { OrderDialog } from './OrderDialog'
import { CATEGORY_LABEL, formatUsd, type AssetCategory, type IndexQuote, type PaperOrderRow, type PortfolioPosition, type SearchResult, type WatchEntry, type WatchPrice } from './types'
import { t } from '@/shared/lib/i18n'
import { tNodes } from '@/shared/lib/i18n-nodes'

// Pagina Assets (PLAN.md Track D, Wave 8 + listă „top" 2026-08-27): căutare + favorite pinned cu
// sparkline + portofoliu + ordine recente + banner paper/live, plus listă S&P 500/Nasdaq 100
// paginată în dreapta (NU ranking live după market cap — Finnhub free n-are așa ceva — doar o
// listă statică mare, cunoscută, cu preț live cerut DOAR pt. pagina vizibilă).

const METALS: WatchEntry[] = [
  { category: 'metal', symbol: 'XAU/USD', name: t('assets:metals.gold') },
  { category: 'metal', symbol: 'XAG/USD', name: t('assets:metals.silver') },
]

function ChangeCell({ change }: { change: number | null }) {
  if (change == null) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn('tnum font-mono text-xs', change >= 0 ? 'text-success-text' : 'text-destructive-text')}>
      {change >= 0 ? '+' : ''}
      {change.toFixed(2)}%
    </span>
  )
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
    queryKey: ['assets', 'search', debounced],
    queryFn: () => api.get<SearchResult[]>(`/api/assets/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 1,
  })

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          placeholder={t('assets:search.placeholder')}
          className="pl-9"
          data-testid="assets-search"
        />
      </div>

      {focused && debounced.length >= 1 ? (
        <div className="absolute z-20 mt-1 max-h-96 w-full overflow-y-auto rounded-md border bg-popover shadow-lg" data-testid="assets-search-results">
          {search.isPending ? (
            <p className="p-3 text-xs text-muted-foreground">{t('common:states.searching')}</p>
          ) : !search.data?.length ? (
            <p className="p-3 text-xs text-muted-foreground">{t('assets:search.noResult')}</p>
          ) : (
            search.data.map((r) => (
              <button
                key={r.symbol}
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  const category: AssetCategory = r.type.toUpperCase().includes('ETF') ? 'etf' : 'stock'
                  onAdd({ category, symbol: r.symbol, name: r.description })
                  setFocused(false)
                }}
              >
                <span className="min-w-0">
                  <span className="font-medium">{r.symbol}</span>
                  <span className="ml-2 truncate text-xs text-muted-foreground">{r.description}</span>
                </span>
                <Badge variant="secondary">{r.type || 'stock'}</Badge>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

export function AssetsPage() {
  const navigate = useNavigate()
  const { can } = useMe()
  const [category, setCategory] = useState<AssetCategory | 'all'>('all')
  const [orderSymbol, setOrderSymbol] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const [searchParams, setSearchParams] = useSearchParams()
  const indexPage = Number(searchParams.get('page') ?? '1') || 1
  const indexLimit = searchParams.get('limit') === '50' ? 50 : 25
  const indexQuery = searchParams.get('q') ?? ''
  // Tabul „Bot" e funcționalitatea `investitii.bots` (doar Vanadium) — fără ea rămâne Piața,
  // chiar dacă cineva intră pe linkul cu ?tab=bot.
  const seesBot = can('investitii.bots')
  const tab = seesBot && searchParams.get('tab') === 'bot' ? 'bot' : 'piata'
  const [indexQueryInput, setIndexQueryInput] = useState(indexQuery)

  useEffect(() => {
    const timer = setTimeout(() => {
      if (indexQueryInput !== indexQuery) setSearchParams({ page: '1', limit: String(indexLimit), q: indexQueryInput })
    }, 300)
    return () => clearTimeout(timer)
  }, [indexQueryInput])

  function setIndexPage(next: { page?: number; limit?: number }) {
    setSearchParams({ page: String(next.page ?? indexPage), limit: String(next.limit ?? indexLimit), q: indexQuery })
  }

  const indexList = useQuery({
    queryKey: ['assets', 'index-list', indexPage, indexLimit, indexQuery],
    queryFn: () =>
      api.get<{ items: IndexQuote[]; totalPages: number; priceKeyMissing: boolean }>(
        `/api/assets/index-list?page=${indexPage}&limit=${indexLimit}${indexQuery ? `&q=${encodeURIComponent(indexQuery)}` : ''}`,
      ),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  })

  const watchPrices = useQuery({
    queryKey: ['assets', 'watchlist-prices'],
    queryFn: () => api.get<WatchPrice[]>('/api/assets/watchlist/prices'),
    refetchInterval: 60_000,
  })

  const settings = useQuery({
    queryKey: ['assets', 'settings'],
    queryFn: () => api.get<{ tradingEnabled: boolean }>('/api/assets/settings'),
  })

  const brokers = useQuery({
    queryKey: ['assets', 'brokers'],
    queryFn: () => api.get<Array<{ broker: string; mode: 'paper' | 'live' }>>('/api/assets/brokers'),
  })

  const portfolio = useQuery({
    queryKey: ['assets', 'portfolio'],
    queryFn: () => api.get<{ positions: PortfolioPosition[]; realizedPnlUsd: number }>('/api/assets/portfolio'),
    staleTime: 60_000,
  })

  const orders = useQuery({
    queryKey: ['assets', 'orders'],
    queryFn: () => api.get<PaperOrderRow[]>('/api/assets/orders'),
    staleTime: 60_000,
  })

  function isWatched(cat: AssetCategory, symbol: string): boolean {
    return watchPrices.data?.some((w) => w.entry.category === cat && w.entry.symbol === symbol) ?? false
  }

  function toggleWatchlist(entry: WatchEntry, present: boolean) {
    const mutation = present
      ? api.delete(`/api/assets/watchlist/${entry.category}/${encodeURIComponent(entry.symbol)}`)
      : api.post('/api/assets/watchlist', entry)
    void mutation
      .then(() => void queryClient.invalidateQueries({ queryKey: ['assets', 'watchlist-prices'] }))
      .catch((err) => toast.error(err instanceof Error ? err.message : String(err)))
  }

  const t212Mode = brokers.data?.find((b) => b.broker === 'trading212')?.mode ?? 'paper'
  const filteredWatch = watchPrices.data?.filter((w) => category === 'all' || w.entry.category === category) ?? []
  const totalValueUsd = portfolio.data?.positions.reduce((sum, p) => sum + (p.valueUsd ?? 0), 0) ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('common:nav.stocks')}
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
            <StocksBotTab />
          </TabsContent>
        )}
        <TabsContent value="piata" className="space-y-6">
        <SearchSection onAdd={(entry) => toggleWatchlist(entry, isWatched(entry.category, entry.symbol))} />

        <div className="flex flex-wrap items-center gap-1">
          {(['all', 'stock', 'etf', 'metal'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                category === c ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {c === 'all' ? t('common:labels.all') : CATEGORY_LABEL[c]}
            </button>
          ))}
          <span className="mx-1 text-muted-foreground">·</span>
          {METALS.map((m) => (
            <button
              key={m.symbol}
              type="button"
              onClick={() => toggleWatchlist(m, isWatched('metal', m.symbol))}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                isWatched('metal', m.symbol) ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {isWatched('metal', m.symbol) ? '★ ' : '+ '}
              {m.name}
            </button>
          ))}
        </div>

        {indexList.data?.priceKeyMissing ? (
          <Alert
            title={t('assets:noPriceKey.title')}
            action={
              can('investitii.setari') ? (
                <Link to="/settings" className="text-foreground underline underline-offset-2">
                  {t('assets:noPriceKey.openSettings')}
                </Link>
              ) : null
            }
          >
            {can('investitii.setari') ? t('assets:noPriceKey.hintAdmin') : t('assets:noPriceKey.hint')}
          </Alert>
        ) : null}

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="min-w-0 space-y-6">
            <section className="space-y-2" data-testid="assets-watchlist">
              <h2 className="text-sm font-semibold">{t('crypto:favorites.title')}</h2>
              {watchPrices.isPending ? (
                <ListSkeleton rows={3} />
              ) : !filteredWatch.length ? (
                <Card>
                  <CardContent className="pt-6 text-sm text-muted-foreground">
                    {t('assets:favorites.empty')}
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  {filteredWatch.map(({ entry, priceUsd, changePct, sparkline }) => (
                    <Card
                      key={`${entry.category}:${entry.symbol}`}
                      className="cursor-pointer py-2.5 transition-colors hover:bg-accent/40"
                      onClick={() => void navigate(`/assets/${entry.category}/${encodeURIComponent(entry.symbol)}`)}
                    >
                      <CardContent className="space-y-1 px-3 pt-0 max-sm:px-3">
                        <div className="flex items-center justify-between gap-1">
                          <p className="min-w-0 truncate text-sm font-medium" title={entry.name}>
                            {entry.symbol}
                            <Badge variant="outline" className="ml-1.5">
                              {CATEGORY_LABEL[entry.category]}
                            </Badge>
                          </p>
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
                        <div className="flex items-end justify-between gap-2">
                          <div className="min-w-0">
                            <p className="tnum font-mono text-sm leading-tight">{formatUsd(priceUsd)}</p>
                            <ChangeCell change={changePct} />
                          </div>
                          <div className="flex items-center gap-2">
                            <MiniSparkline values={sparkline} width={72} height={24} />
                            <Button
                              variant="outline"
                              onClick={(e) => {
                                e.stopPropagation()
                                setOrderSymbol(entry.symbol)
                              }}
                            >
                              {t('common:labels.order')}
                            </Button>
                          </div>
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
                  <ListSkeleton rows={4} />
                ) : !portfolio.data?.positions.length ? (
                  <p className="text-sm text-muted-foreground">
                    {t('assets:portfolio.empty')}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('common:labels.symbol')}</TableHead>
                        <TableHead priority="md">{t('common:labels.quantity')}</TableHead>
                        <TableHead className="text-right">{t('common:labels.value')}</TableHead>
                        <TableHead className="text-right">P&L</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {portfolio.data.positions.map((pos) => (
                        <TableRow key={`${pos.source}-${pos.symbol}`}>
                          <TableCell className="font-medium">
                            {pos.symbol} <Badge variant="outline" className="ml-1">{pos.source}</Badge>
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
                  <ul className="space-y-1.5 font-mono text-xs" data-testid="assets-orders-list">
                    {orders.data.slice(0, 10).map((order) => (
                      <li key={order.id} className="flex items-center justify-between gap-2 border-b pb-1 last:border-none">
                        <span>
                          <span className={order.side === 'buy' ? 'text-success-text' : 'text-destructive-text'}>
                            {order.side === 'buy' ? 'BUY' : 'SELL'}
                          </span>{' '}
                          {Number(order.quantity).toPrecision(6)} {order.symbol}
                        </span>
                        <span className="text-muted-foreground">
                          {order.executedPrice ? formatUsd(Number(order.executedPrice)) : order.status}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <section className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">S&amp;P 500 / Nasdaq 100</h2>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={indexQueryInput}
                  onChange={(e) => setIndexQueryInput(e.target.value)}
                  placeholder={t('assets:index.filterPlaceholder')}
                  className="w-40"
                />
                <div className="flex gap-1">
                  {[25, 50].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setIndexPage({ page: 1, limit: n })}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs transition-colors',
                        indexLimit === n ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent',
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <Card>
              <CardContent className="pt-0">
                {indexList.isPending ? (
                  <ListSkeleton rows={8} />
                ) : indexList.isError ? (
                  <p className="pt-6 text-sm text-destructive">{(indexList.error as Error).message}</p>
                ) : !indexList.data?.items.length ? (
                  <p className="pt-6 text-sm text-muted-foreground">{t('assets:index.noResult')}</p>
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8" />
                          <TableHead>{t('common:labels.symbol')}</TableHead>
                          <TableHead className="text-right">{t('common:labels.price')}</TableHead>
                          <TableHead className="text-right">{t('assets:index.change')}</TableHead>
                          <TableHead priority="md" className="text-right">{t('common:labels.order')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {indexList.data.items.map((row) => {
                          const watched = isWatched('stock', row.symbol)
                          return (
                            <TableRow
                              key={row.symbol}
                              className="cursor-pointer"
                              onClick={() => void navigate(`/assets/stock/${encodeURIComponent(row.symbol)}`)}
                              data-testid="assets-index-row"
                            >
                              <TableCell>
                                <button
                                  type="button"
                                  aria-label={watched ? t('crypto:favorites.remove') : t('crypto:favorites.add')}
                                  className="rounded p-0.5 hover:bg-accent"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    toggleWatchlist({ category: 'stock', symbol: row.symbol, name: row.name }, watched)
                                  }}
                                >
                                  <Star className={cn('h-3.5 w-3.5', watched ? 'fill-warning text-warning' : 'text-muted-foreground')} />
                                </button>
                              </TableCell>
                              <TableCell>
                                <span className="font-medium">{row.symbol}</span>
                                <span className="ml-2 truncate text-xs text-muted-foreground tbl-md">{row.name}</span>
                              </TableCell>
                              <TableCell className="tnum text-right font-mono text-xs">{formatUsd(row.priceUsd)}</TableCell>
                              <TableCell className="text-right">
                                <ChangeCell change={row.changePct} />
                              </TableCell>
                              <TableCell priority="md" className="text-right">
                                <Button
                                  variant="outline"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setOrderSymbol(row.symbol)
                                  }}
                                >
                                  {t('common:labels.order')}
                                </Button>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                    <div className="flex items-center justify-between border-t p-2">
                      <Button variant="ghost" disabled={indexPage <= 1} onClick={() => setIndexPage({ page: Math.max(1, indexPage - 1) })}>
                        <ChevronLeft className="h-4 w-4" /> {t('crypto:market.previous')}
                      </Button>
                      <span className="tnum text-xs text-muted-foreground">
                        {t('crypto:market.pageOf', { page: indexPage, total: indexList.data.totalPages })}
                      </span>
                      <Button
                        variant="ghost"
                        disabled={indexPage >= indexList.data.totalPages}
                        onClick={() => setIndexPage({ page: indexPage + 1 })}
                      >
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

      <OrderDialog
        open={orderSymbol !== null}
        onOpenChange={(open) => {
          if (!open) setOrderSymbol(null)
        }}
        defaultSymbol={orderSymbol ?? ''}
        liveMode={t212Mode === 'live'}
      />
    </div>
  )
}
