import { useQuery } from '@tanstack/react-query'
import { BotHealth, BotSkeleton, PaperBadge } from '@/shared/components/bot/BotStatus'
import { EquityChart } from '@/shared/components/bot/EquityChart'
import { Leaderboard } from '@/shared/components/bot/Leaderboard'
import { TradesFeed } from '@/shared/components/bot/TradesFeed'
import { formatSeconds } from '@/shared/components/bot/types'
import { api } from '@/shared/lib/api'
import { LearningPanel } from './LearningPanel'
import type { BotOverview, BotSnapshot } from './types'
import { t } from '@/shared/lib/i18n'
import { tNodes } from '@/shared/lib/i18n-nodes'

// The "Bot" tab in Crypto: jeffbot, an external paper trading bot. Its data arrives by push
// every 5 minutes (modules/jeffbot in the backend); this tab only reads. No trading action:
// everything shown is on paper.
export function BotTab() {
  const overview = useQuery({
    queryKey: ['jeffbot', 'overview'],
    queryFn: () => api.get<BotOverview | null>('/api/jeffbot/overview'),
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
        <p className="text-sm font-medium">{t('crypto:bot.noDataTitle')}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('crypto:bot.noDataHint')}
        </p>
      </div>
    )
  }

  const { snapshot, receivedAt, trades, reviews } = overview.data
  return (
    <div className="space-y-8">
      <StatusStrip snapshot={snapshot} receivedAt={receivedAt} />
      <Leaderboard strategies={snapshot.strategies} currency="USDT" featured={{ key: 'mix', label: 'MIX' }} />
      <EquityChart strategies={snapshot.strategies} market="crypto" />
      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <TradesFeed trades={trades} strategies={snapshot.strategies} />
        <LearningPanel snapshot={snapshot} reviews={reviews} />
      </div>
    </div>
  )
}

function StatusStrip({ snapshot, receivedAt }: { snapshot: BotSnapshot; receivedAt: string }) {
  const oldestCandle = Math.max(0, ...snapshot.data.prices.map((p) => p.lastCandleAgeSec ?? 0))
  const { news, sourceErrors, fearGreed } = snapshot.data

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <BotHealth receivedAt={receivedAt} services={snapshot.services} />
        <span className="text-muted-foreground">
          {t('crypto:bot.prices')} <span className="tnum">{formatSeconds(oldestCandle)}</span>
        </span>
        <span className="text-muted-foreground">
          {tNodes('crypto:bot.newsLine', {
            count: <span className="tnum">{news.last24h}</span>,
            labeled: (
              <span className="tnum">
                {news.labeled}/{news.total}
              </span>
            ),
          })}
        </span>
        {fearGreed ? (
          <span className="text-muted-foreground">
            Fear &amp; Greed <span className="tnum">{fearGreed.value}</span> ({fearGreed.label})
          </span>
        ) : null}
        <PaperBadge />
      </div>
      {sourceErrors.length ? (
        <p className="text-xs text-warning [overflow-wrap:anywhere]">
          {t('crypto:bot.sourceErrors', {
            list: sourceErrors
              .map((e) => (e.sinceSec ? t('crypto:bot.errorSince', { source: e.source, error: e.error, since: formatSeconds(e.sinceSec) }) : `${e.source} (${e.error})`))
              .join(' · '),
          })}
        </p>
      ) : null}
    </div>
  )
}
