import { useId } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { cn } from '@/shared/lib/utils'
import { formatMoney, formatPct, pnlClass, REFERENCE_KEY, returnPct, strategyColor, type BotStrategy } from './types'
import { t } from '@/shared/lib/i18n'

// `featured`: strategia al cărei randament e numărul mare din antet (MIX pe crypto). Bursa
// n-are o strategie favorită, deci acolo antetul rămâne doar titlul.
export function Leaderboard({
  strategies,
  currency,
  featured: featuredSpec,
  referenceLabel = 'buy & hold',
}: {
  strategies: BotStrategy[]
  currency: string
  featured?: { key: string; label: string }
  referenceLabel?: string
}) {
  const featuredKey = featuredSpec?.key
  const reference = strategies.find((s) => s.key === REFERENCE_KEY)
  const referencePct = reference ? returnPct(reference) : null
  const ranked = [...strategies].sort((a, b) => returnPct(b) - returnPct(a))
  const featured = featuredKey ? strategies.find((s) => s.key === featuredKey) : undefined
  const titleId = useId()

  return (
    <section className="space-y-3" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={titleId} className="text-sm font-semibold">
          {t('common:bot.leaderboard.title')}
        </h2>
        {featured ? (
          <p className="text-sm text-muted-foreground">
            {featuredSpec!.label}{' '}
            <span className={cn('tnum text-2xl font-semibold', pnlClass(returnPct(featured)))}>{formatPct(returnPct(featured))}</span>
            <span className="tnum ml-2">{formatMoney(featured.equity, currency)}</span>
          </p>
        ) : null}
      </div>
      {!strategies.length ? (
        <p className="text-sm text-muted-foreground">{t('common:bot.leaderboard.empty')}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-normal">{t('common:bot.strategy')}</TableHead>
              <TableHead className="text-right font-normal">{t('common:bot.leaderboard.return')}</TableHead>
              <TableHead className="hidden text-right font-normal sm:table-cell">{t('common:bot.leaderboard.vsReference', { referenceLabel })}</TableHead>
              <TableHead className="hidden text-right font-normal md:table-cell">{t('common:bot.leaderboard.maxDrawdown')}</TableHead>
              <TableHead className="hidden text-right font-normal lg:table-cell">{t('common:bot.leaderboard.trades')}</TableHead>
              <TableHead className="hidden text-right font-normal lg:table-cell">{t('common:bot.leaderboard.fees')}</TableHead>
              <TableHead className="font-normal">{t('common:bot.leaderboard.holds')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ranked.map((s) => {
              const pct = returnPct(s)
              const isReference = s.key === REFERENCE_KEY
              const vsHold = referencePct == null || isReference ? null : pct - referencePct
              return (
                <TableRow key={s.key} className={cn(s.key === featuredKey && 'bg-muted/50')}>
                  <TableCell className="whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: strategyColor(s.key) }}
                      />
                      <span className={cn(s.key === featuredKey && 'font-medium')}>{s.label}</span>
                      {isReference ? <span className="text-xs text-muted-foreground">{t('common:bot.leaderboard.reference')}</span> : null}
                    </span>
                  </TableCell>
                  <TableCell className={cn('tnum text-right font-mono text-xs', pnlClass(pct))}>{formatPct(pct)}</TableCell>
                  <TableCell className="tnum hidden text-right font-mono text-xs text-muted-foreground sm:table-cell">
                    {vsHold == null ? '—' : `${vsHold > 0 ? '+' : ''}${vsHold.toFixed(2)} pp`}
                  </TableCell>
                  <TableCell className="tnum hidden text-right font-mono text-xs text-muted-foreground md:table-cell">
                    {s.maxDdPct.toFixed(1)}%
                  </TableCell>
                  <TableCell className="tnum hidden text-right font-mono text-xs text-muted-foreground lg:table-cell">{s.trades}</TableCell>
                  <TableCell className="tnum hidden text-right font-mono text-xs text-muted-foreground lg:table-cell">
                    {s.feesUsdt.toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <Holdings strategy={s} />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </section>
  )
}

function Holdings({ strategy }: { strategy: BotStrategy }) {
  if (!strategy.holdings.length) return <span className="text-xs text-muted-foreground">{t('common:bot.leaderboard.cash')}</span>
  return (
    <span className="flex flex-wrap gap-1">
      {strategy.holdings.map((h) => (
        <span key={h.symbol} className="tnum whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-xs" title={`${h.qty} ${h.symbol}`}>
          {h.symbol.replace(/USDT$/, '')}
          {strategy.key === 'lgbm' ? ` ${h.qty > 0 ? 'long' : 'short'}` : ''}{' '}
          <span className="text-muted-foreground">{Math.round(h.valueUsdt)}$</span>
        </span>
      ))}
    </span>
  )
}
