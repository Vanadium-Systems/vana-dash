import { useMe } from '@/shared/hooks/use-me'
import { t } from '@/shared/lib/i18n'
import type { MoneyMeta } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'

/** The mark in front of a converted amount. Text, not color: it has to survive a screenshot. */
export const APPROX = '≈'

/** `≈ 1.234,50 EUR` for a converted amount; the plain amount when it is in the books' currency. */
export function approx(formatted: string, money: MoneyMeta | undefined): string {
  return money?.converted ? `${APPROX} ${formatted}` : formatted
}

/**
 * One line under a group of totals, when they are not in lei as the books hold them: either
 * they were converted, or the person asked for a currency there is no rate for.
 */
export function MoneyNote({ money, className }: { money: MoneyMeta | undefined; className?: string }) {
  const { session } = useMe()
  if (!money || (!money.converted && !money.fallback)) return null
  return (
    <p className={cn('text-xs text-muted-foreground', className)}>
      {money.fallback
        ? t('common:money.noRate', { currency: session?.displayCurrency ?? '' })
        : t('common:money.converted', { currency: money.currency })}
    </p>
  )
}
