import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Delta } from '@/shared/components/Delta'
import { Money } from '@/shared/components/Money'
import { APPROX, MoneyNote } from '@/shared/components/MoneyNote'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { useEmailUnreadCounts } from '@/shared/hooks/use-email-unread-counts'
import { useMe } from '@/shared/hooks/use-me'
import { useMoneyQuery } from '@/shared/hooks/use-money-query'
import { companyTimeZone, intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { BASE_CURRENCY } from '@/shared/lib/locale'
import type { PnlResponse } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { previousMonthName, useCollectedThisMonth } from './widgets/money-widgets'

interface Figure {
  id: string
  label: string
  value: ReactNode
  /** "Where it comes from": the inspector under the band, aligned with the figure. */
  source: string
  to: string
}

/** A figure you can inspect: dotted underline, the inspector opens under the band (DESIGN.md "Figures and money"). */
function FigureButton({ figure, primary, open, onToggle }: { figure: Figure; primary?: boolean; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls="home-inspector"
      onClick={onToggle}
      className="group min-w-0 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="block truncate text-xs text-muted-foreground">{figure.label}</span>
      <span
        className={cn(
          'block whitespace-nowrap underline decoration-dotted decoration-text-3/60 underline-offset-4 group-hover:decoration-text-3',
          primary ? 'text-figure font-semibold tracking-title' : 'mt-0.5 text-lg font-medium',
        )}
      >
        {figure.value}
      </span>
    </button>
  )
}

function MoneyFigures() {
  const [inspected, setInspected] = useState<string | null>(null)
  const series = useCollectedThisMonth()
  const pnl = useMoneyQuery<PnlResponse>(['financials', 'pnl', 'mtd', 'compare'], '/api/financials/pnl?period=mtd&compare=previous', { staleTime: 30_000 })
  const recurring = useMoneyQuery<{ mrrDisplay: number }>(['financials', 'recurring-revenue'], '/api/financials/recurring-revenue', { staleTime: 60_000 })
  const currency = t(`common:money.units.${series.money?.currency ?? BASE_CURRENCY}`)
  const monthName = new Intl.DateTimeFormat(intlTag(), { month: 'long', timeZone: companyTimeZone() }).format(new Date())

  if (series.isPending) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-56" />
      </div>
    )
  }

  const collected = series.data?.total ?? 0
  const invoiced = pnl.data?.totals?.revenue ?? null
  const approx = series.money?.converted ? `${APPROX} ` : null
  const figures: Figure[] = [
    {
      id: 'collected',
      label: t('overview:money.collectedIn', { monthName }),
      value: (
        <>
          {approx}
          <Money amount={collected} currency={currency} tabular={false} />
        </>
      ),
      source: t('overview:inspector.collected', { monthName }),
      to: '/accounting?status=paid',
    },
  ]
  if (invoiced !== null) {
    figures.push({
      id: 'invoiced',
      label: t('overview:figures.invoiced'),
      value: <Money amount={invoiced} currency={currency} tabular={false} />,
      source: t('overview:inspector.invoiced', { monthName }),
      to: '/accounting',
    })
    figures.push({
      id: 'toCollect',
      label: t('overview:figures.toCollect'),
      value: <Money amount={Math.max(0, invoiced - collected)} currency={currency} tabular={false} />,
      source: t('overview:inspector.toCollect', { monthName }),
      to: '/accounting?status=open',
    })
  }
  if (recurring.data && recurring.data.mrrDisplay > 0) {
    figures.push({
      id: 'mrr',
      label: t('overview:figures.mrr'),
      value: <Money amount={recurring.data.mrrDisplay} currency={currency} tabular={false} />,
      source: t('overview:inspector.mrr'),
      to: '/clients',
    })
  }
  const [primary, ...secondary] = figures
  const open = figures.find((f) => f.id === inspected)

  return (
    <section aria-label={t('overview:figures.label')}>
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <div className="min-w-0">
          <FigureButton figure={primary!} primary open={inspected === primary!.id} onToggle={() => setInspected((id) => (id === primary!.id ? null : primary!.id))} />
          {series.data?.delta ? <Delta delta={series.data.delta} currency={currency} against={previousMonthName()} className="mt-1 block" /> : null}
        </div>
        {secondary.map((figure) => (
          <FigureButton key={figure.id} figure={figure} open={inspected === figure.id} onToggle={() => setInspected((id) => (id === figure.id ? null : figure.id))} />
        ))}
      </div>
      {open ? (
        <div id="home-inspector" role="region" aria-label={open.label} className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted px-4 py-3 text-sm">
          <p className="min-w-0 max-w-2xl text-muted-foreground">{open.source}</p>
          <Link to={open.to} className="shrink-0 font-medium text-primary hover:underline">
            {t('overview:inspector.open')}
          </Link>
        </div>
      ) : null}
      <MoneyNote money={series.money} className="mt-2" />
    </section>
  )
}

/** For someone without `financiar.view`: their own number, not the company's money. */
function PersonalFigures() {
  const unread = useEmailUnreadCounts()
  const { can } = useMe()
  if (!can('email.view')) return null
  return (
    <section aria-label={t('overview:figures.label')}>
      <p className="text-xs text-muted-foreground">{t('overview:email.unread')}</p>
      {unread.isPending ? <Skeleton className="mt-1 h-9 w-24" /> : <p className="text-figure font-semibold tnum">{unread.data?.inbox ?? 0}</p>}
    </section>
  )
}

export function HomeFigures() {
  const { can } = useMe()
  return can('financiar.view') ? <MoneyFigures /> : <PersonalFigures />
}
