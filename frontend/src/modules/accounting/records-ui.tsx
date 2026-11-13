import { Money } from '@/shared/components/Money'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { StatePill, type StateTone } from '@/shared/components/ui/state-pill'
import { useMe } from '@/shared/hooks/use-me'
import { formatDate, formatMoney } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { BASE_CURRENCY } from '@/shared/lib/locale'
import type { PaymentMethod, PaymentStatus, RecordsPage } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { daysOverdue } from './records-logic'

type Direction = 'in' | 'out'

const PAYMENT_TONE: Record<PaymentStatus, StateTone> = { unpaid: 'neutral', partial: 'warning', paid: 'success' }

/** "Neîncasată" / "Parțial · rest X" / "Încasată" ("Plătită" on received documents). The rest is text, so colour is never alone. */
export function RecordPaymentBadge({ direction, status, remaining, currency, overdue }: { direction: Direction; status: PaymentStatus; remaining: number; currency: string; overdue?: boolean }) {
  const label =
    status === 'partial'
      ? t('accounting:records.payment.partial', { rest: formatMoney(remaining, currency) })
      : t(`accounting:records.payment.${direction}.${status}` as const)
  return <StatePill tone={overdue && status !== 'paid' ? 'warning' : PAYMENT_TONE[status]}>{label}</StatePill>
}

/** One word for the state, used where a state moves to another ("Neîncasată → Parțial"). */
export function paymentWord(direction: Direction, status: PaymentStatus): string {
  return status === 'partial' ? t('accounting:records.payment.partialWord') : t(`accounting:records.payment.${direction}.${status}` as const)
}

/** The due date; past it, a warm "de 12 zile" next to it. */
export function DueDate({ dueAt, overdue, className }: { dueAt: string | null; overdue: boolean; className?: string }) {
  if (!dueAt) return <span className={className}>—</span>
  const days = overdue ? daysOverdue(dueAt) : 0
  return (
    <span className={cn('whitespace-nowrap', overdue && 'text-warning-text', className)}>
      {formatDate(dueAt)}
      {days > 0 ? <span> · {t('accounting:records.overdueBy', { count: days })}</span> : null}
    </span>
  )
}

/** The amount first and heavy, the decimals dimmed by `Money`; a foreign-currency document shows its value in the company's currency under it. */
export function AmountCell({ amount, currency, secondary }: { amount: string | number; currency: string; secondary?: { amount: number; currency: string } | null }) {
  return <Money amount={amount} currency={currency} secondary={secondary ?? undefined} className="text-sm font-semibold" />
}

export const methodLabel = (method: PaymentMethod) => t(`accounting:records.method.${method}` as const)

/**
 * Totals above the table, following the period and the search but not the status tab. One figure
 * leads (what is still to be collected or paid); the others are quieter and sit in a plain row.
 */
export function TotalsBand({ direction, totals, loading, stale }: { direction: Direction; totals: RecordsPage['totals'] | undefined; loading: boolean; stale: boolean }) {
  const { session } = useMe()
  const currency = session?.tenant?.currency ?? BASE_CURRENCY
  const items: Array<{ key: string; label: string; value: number; lead?: boolean; warm?: boolean }> = totals
    ? [
        { key: 'open', label: t(`accounting:records.totals.${direction}.open` as const), value: totals.open, lead: true },
        { key: 'total', label: t('accounting:records.totals.total'), value: totals.total },
        { key: 'paid', label: t(`accounting:records.totals.${direction}.paid` as const), value: totals.paid },
        { key: 'overdue', label: t('accounting:records.totals.overdue'), value: totals.overdue, warm: totals.overdue > 0 },
      ]
    : []
  return (
    <div className={cn('transition-opacity duration-fast', stale && 'opacity-60')} aria-busy={loading || stale} data-testid="records-totals">
      {loading || !totals ? (
        <div className="flex flex-wrap items-end gap-x-8 gap-y-2" aria-hidden="true">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-5 w-28" />
        </div>
      ) : (
        <dl className="flex flex-wrap items-end gap-x-8 gap-y-2">
          {items.map((item) => (
            <div key={item.key}>
              <dt className="text-xs text-muted-foreground">{item.label}</dt>
              <dd className={cn('tnum whitespace-nowrap', item.lead ? 'text-2xl font-semibold' : 'text-sm', item.warm && 'text-warning-text')}>
                <Money amount={item.value} currency={currency} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-1.5 text-xs text-muted-foreground">{t('accounting:records.totals.note', { currency })}</p>
    </div>
  )
}
