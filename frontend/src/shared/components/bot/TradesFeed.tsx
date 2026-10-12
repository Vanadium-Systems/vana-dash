import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { formatPrice, type BotStrategy, type BotTrade } from './types'

const SIDE_LABEL: Record<BotTrade['side'], string> = {
  buy: 'Cumpărat',
  sell: 'Vândut',
  long: 'Long',
  short: 'Short',
  flat: 'Închis',
}

export function TradesFeed({ trades, strategies }: { trades: BotTrade[]; strategies: BotStrategy[] }) {
  const labelByKey = new Map(strategies.map((s) => [s.key, s.label]))

  return (
    <section className="min-w-0 space-y-2" aria-labelledby="bot-trades-title">
      <h2 id="bot-trades-title" className="text-sm font-semibold">
        Ce face
      </h2>
      {!trades.length ? (
        <p className="text-sm text-muted-foreground">Nicio tranzacție încă. Strategiile intră la primul semnal.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-normal">Când</TableHead>
              <TableHead className="font-normal">Tranzacție</TableHead>
              <TableHead className="text-right font-normal">Preț</TableHead>
              <TableHead className="hidden font-normal md:table-cell">Strategie</TableHead>
              <TableHead className="hidden font-normal lg:table-cell">Motiv</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trades.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="tnum whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(t.ts).toLocaleString('ro-RO', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {SIDE_LABEL[t.side]} <span className="font-medium">{t.symbol.replace(/USDT$/, '')}</span>
                  <span className="tnum ml-1.5 font-mono text-xs text-muted-foreground">{Number(t.qty.toPrecision(6))}</span>
                </TableCell>
                <TableCell className="tnum text-right font-mono text-xs">{formatPrice(t.price)}</TableCell>
                <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground md:table-cell" title={t.subAccount ?? undefined}>
                  {labelByKey.get(t.strategy) ?? t.strategy}
                </TableCell>
                <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                  <span className="block max-w-[9rem] truncate" title={t.reason ?? undefined}>
                    {t.reason ?? '—'}
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
