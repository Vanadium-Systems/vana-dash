import { formatMoneyParts } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'

interface MoneyAmount {
  amount: number | string
  currency: string
}

interface MoneyProps extends MoneyAmount {
  /** Same amount in another currency, on a line below. */
  secondary?: MoneyAmount
  /** Privacy mode: dots instead of the figure. */
  hide?: boolean
  /** Color by sign and a leading "+" on positive amounts. */
  sign?: boolean
  className?: string
}

function Figure({ amount, currency, plus }: MoneyAmount & { plus?: boolean }) {
  const { whole, fraction, suffix } = formatMoneyParts(amount, currency)
  return (
    <>
      {plus ? '+' : null}
      {whole}
      {fraction ? <span className="text-[0.8em] text-muted-foreground">{fraction}</span> : null}
      {suffix}
    </>
  )
}

export function Money({ amount, currency, secondary, hide, sign, className }: MoneyProps) {
  if (hide) {
    return (
      <span role="img" aria-label={t('common:money.hidden')} className={cn('tnum', className)}>
        ••••
      </span>
    )
  }
  const value = Number(amount)
  return (
    <span className={cn('tnum whitespace-nowrap', sign && value > 0 && 'text-success-text', sign && value < 0 && 'text-destructive-text', className)}>
      <Figure amount={amount} currency={currency} plus={sign && value > 0} />
      {secondary ? (
        <span className="block text-xs text-muted-foreground">
          <Figure amount={secondary.amount} currency={secondary.currency} />
        </span>
      ) : null}
    </span>
  )
}
