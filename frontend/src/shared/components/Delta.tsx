import { formatMoney, intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { Delta as DeltaValue } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'

interface DeltaProps {
  delta: DeltaValue
  /** The unit of `abs` as it should be written ("lei", "RON"). */
  currency: string
  /** What it is compared with, written out: "față de octombrie". */
  against: string
  /** Colour says good or bad, not up or down: for costs, up is bad. */
  higherIsBetter?: boolean
  className?: string
}

/** "+12% · +4.820 lei față de octombrie": the change in percent and in value, with the period. */
export function Delta({ delta, currency, against, higherIsBetter = true, className }: DeltaProps) {
  const abs = Number(delta.abs)
  const sign = abs > 0 ? '+' : abs < 0 ? '−' : ''
  const good = abs === 0 ? null : (abs > 0) === higherIsBetter
  const pct = delta.pct === null ? null : `${sign}${Math.abs(delta.pct).toLocaleString(intlTag(), { maximumFractionDigits: 1 })}%`
  return (
    <span className={cn('whitespace-nowrap text-sm', className)}>
      <span className={cn('tnum font-medium', good === true && 'text-success-text', good === false && 'text-destructive-text')}>
        {pct ? `${pct} · ` : null}
        {sign}
        {formatMoney(Math.abs(abs), currency)}
      </span>{' '}
      <span className="text-muted-foreground">{t('common:delta.against', { period: against })}</span>
    </span>
  )
}
