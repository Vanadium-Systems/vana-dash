import { formatMoney } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { MoneySum } from './types'

/** Amounts per currency, with the company-currency equivalent below when it says something the lines do not. */
export function Sums({ sums, equivalent, companyCurrency }: { sums: MoneySum[]; equivalent?: number | null; companyCurrency: string }) {
  if (sums.length === 0) return <p className="text-xs text-muted-foreground">—</p>
  const showEquivalent = equivalent !== null && equivalent !== undefined && (sums.length > 1 || sums[0]!.currency !== companyCurrency)
  return (
    <div className="space-y-0.5 text-xs tabular-nums">
      {sums.map((sum) => (
        <p key={sum.currency} className="truncate font-medium">
          {formatMoney(sum.amount, sum.currency, { decimals: 0 })}
        </p>
      ))}
      {showEquivalent ? <p className="truncate text-muted-foreground">{t('clients:board.equivalent', { amount: formatMoney(equivalent, companyCurrency, { decimals: 0 }) })}</p> : null}
    </div>
  )
}
