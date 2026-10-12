import { useQuery } from '@tanstack/react-query'
import { BotHealth, BotSkeleton, PaperBadge } from '@/shared/components/bot/BotStatus'
import { EquityChart } from '@/shared/components/bot/EquityChart'
import { Leaderboard } from '@/shared/components/bot/Leaderboard'
import { TradesFeed } from '@/shared/components/bot/TradesFeed'
import { formatSeconds } from '@/shared/components/bot/types'
import { api } from '@/shared/lib/api'
import { LearningPanel } from './LearningPanel'
import type { BotOverview, BotSnapshot } from './types'

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
      <p className="py-12 text-center text-sm text-muted-foreground">Nu am putut încărca starea botului. Reîncerc automat într-un minut.</p>
    )
  }
  if (!overview.data) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm font-medium">Botul n-a trimis încă date</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Primul snapshot apare după ce exportul botului rulează cu tokenul de ingest configurat.
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
          Prețuri <span className="tnum">{formatSeconds(oldestCandle)}</span>
        </span>
        <span className="text-muted-foreground">
          Știri 24h <span className="tnum">{news.last24h}</span> · etichetate{' '}
          <span className="tnum">
            {news.labeled}/{news.total}
          </span>
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
          Surse cu erori:{' '}
          {sourceErrors.map((e) => `${e.source} (${e.error}${e.sinceSec ? `, de ${formatSeconds(e.sinceSec)}` : ''})`).join(' · ')}
        </p>
      ) : null}
    </div>
  )
}
