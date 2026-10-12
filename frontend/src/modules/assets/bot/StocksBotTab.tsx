import { useQuery } from '@tanstack/react-query'
import { BotReviews } from '@/shared/components/bot/BotReviews'
import { BotHealth, BotSkeleton, PaperBadge } from '@/shared/components/bot/BotStatus'
import { EquityChart } from '@/shared/components/bot/EquityChart'
import { Leaderboard } from '@/shared/components/bot/Leaderboard'
import { NewsList } from '@/shared/components/bot/NewsList'
import { TradesFeed } from '@/shared/components/bot/TradesFeed'
import { formatSeconds, type StocksOverview, type StocksSnapshot } from '@/shared/components/bot/types'
import { api } from '@/shared/lib/api'
import { cn } from '@/shared/lib/utils'
import { formatSessionTime, pricesLate } from './session'
import { t } from '@/shared/lib/i18n'
import { tNodes } from '@/shared/lib/i18n-nodes'

// Tab „Bot" din Assets: portofoliul pe hârtie al jeffbot pe ETF-uri americane (PLAN.md
// Contract C/D). Simularea rulează pe serverul botului, Alpaca dă doar prețurile și programul bursei.
// Nicio acțiune de tranzacționare de aici.
export function StocksBotTab() {
  const overview = useQuery({
    queryKey: ['jeffbot', 'overview', 'stocks'],
    queryFn: () => api.get<StocksOverview | null>('/api/jeffbot/overview?market=stocks'),
    refetchInterval: 60_000,
  })

  if (overview.isPending) return <BotSkeleton />
  if (overview.isError) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">{t('crypto:bot.loadFailed')}</p>
    )
  }
  if (!overview.data) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm font-medium">{t('assets:bot.noDataTitle')}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('assets:bot.noDataHint')}
        </p>
      </div>
    )
  }

  const { snapshot, receivedAt, trades, reviews } = overview.data
  return (
    <div className="space-y-8">
      <StatusStrip snapshot={snapshot} receivedAt={receivedAt} />
      <Leaderboard strategies={snapshot.strategies} currency={snapshot.currency} referenceLabel="SPY" />
      <EquityChart strategies={snapshot.strategies} market="stocks" />
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <TradesFeed trades={trades} strategies={snapshot.strategies} />
        <div className="min-w-0 space-y-6">
          <BotReviews reviews={reviews} standalone />
          <NewsList
            news={snapshot.news ?? []}
            tags={(n) => [n.etfs.join(', '), n.category ? n.category.replaceAll('_', ' ') : '']}
            title={t('assets:bot.newsHint')}
          />
        </div>
      </div>
    </div>
  )
}

function StatusStrip({ snapshot, receivedAt }: { snapshot: StocksSnapshot; receivedAt: string }) {
  const { session, broker } = snapshot
  const oldestPrice = Math.max(0, ...snapshot.prices.map((p) => p.ageSec ?? 0))
  const late = pricesLate(session.isOpen, oldestPrice)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <BotHealth receivedAt={receivedAt} services={snapshot.services} />
        <span className="text-muted-foreground">
          {session.isOpen
            ? session.nextClose
              ? tNodes('assets:bot.closesAt', { state: t('assets:bot.marketOpen'), time: <span className="tnum">{formatSessionTime(session.nextClose)}</span> })
              : t('assets:bot.marketOpen')
            : session.nextOpen
              ? tNodes('assets:bot.opensAt', { state: t('assets:bot.marketClosed'), time: <span className="tnum">{formatSessionTime(session.nextOpen)}</span> })
              : t('assets:bot.marketClosed')}
        </span>
        <span className={cn(broker.ok ? 'text-muted-foreground' : 'font-medium text-foreground')}>
          {t('assets:bot.broker', { mode: broker.mode === 'paper' ? 'paper' : 'live', state: broker.ok ? t('assets:bot.connected') : t('assets:bot.error') })}
        </span>
        <span className={cn(late ? 'font-medium text-warning' : 'text-muted-foreground')}>
          {t('crypto:bot.prices')} <span className="tnum">{formatSeconds(oldestPrice)}</span>
          {late ? t('assets:bot.late') : ''}
        </span>
        <PaperBadge />
      </div>
      {!broker.ok && broker.error ? (
        <p className="text-xs text-warning [overflow-wrap:anywhere]">{t('assets:bot.brokerError', { error: broker.error })}</p>
      ) : null}
    </div>
  )
}
