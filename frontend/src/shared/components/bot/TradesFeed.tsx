import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { formatPrice, type BotStrategy, type BotTrade } from './types'
import { t } from '@/shared/lib/i18n'
import { intlTag } from '@/shared/lib/format'

const SIDE_LABEL: Record<BotTrade['side'], string> = {
  buy: t('common:bot.trades.bought'),
  sell: t('common:bot.trades.sold'),
  long: t('common:bot.trades.long'),
  short: t('common:bot.trades.short'),
  flat: t('common:bot.trades.closed'),
}

export function TradesFeed({ trades, strategies }: { trades: BotTrade[]; strategies: BotStrategy[] }) {
  const labelByKey = new Map(strategies.map((s) => [s.key, s.label]))

  return (
    <section className="min-w-0 space-y-2" aria-labelledby="bot-trades-title">
      <h2 id="bot-trades-title" className="text-sm font-semibold">
        {t('common:bot.trades.title')}
      </h2>
      {!trades.length ? (
        <p className="text-sm text-muted-foreground">{t('common:bot.trades.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-normal">{t('common:labels.when')}</TableHead>
              <TableHead className="font-normal">{t('common:bot.trades.trade')}</TableHead>
              <TableHead className="text-right font-normal">{t('common:labels.price')}</TableHead>
              <TableHead className="hidden font-normal md:table-cell">{t('common:bot.strategy')}</TableHead>
              <TableHead className="hidden font-normal lg:table-cell">{t('common:labels.reason')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.map((trade) => (
              <TableRow key={trade.id}>
                <TableCell className="tnum whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(trade.ts).toLocaleString(intlTag(), {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {SIDE_LABEL[trade.side]} <span className="font-medium">{trade.symbol.replace(/USDT$/, '')}</span>
                  <span className="tnum ml-1.5 font-mono text-xs text-muted-foreground">{Number(trade.qty.toPrecision(6))}</span>
                </TableCell>
                <TableCell className="tnum text-right font-mono text-xs">{formatPrice(trade.price)}</TableCell>
                <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground md:table-cell" title={trade.subAccount ?? undefined}>
                  {labelByKey.get(trade.strategy) ?? trade.strategy}
                </TableCell>
                <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                  <span className="block max-w-[9rem] truncate" title={trade.reason ?? undefined}>
                    {trade.reason ?? '—'}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  )
}
