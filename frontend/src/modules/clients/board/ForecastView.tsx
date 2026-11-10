import { formatDate, formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { Sums } from './Sums'
import type { ForecastBucket, ForecastResponse } from './types'

const monthLabel = (month: string) => formatDate(`${month}-15T12:00:00`, { month: 'long', year: 'numeric' })

function Bucket({ title, bucket, currency }: { title: string; bucket: ForecastBucket; currency: string }) {
  return (
    <div className="min-w-0 space-y-2 rounded-md bg-muted/40 p-3">
      <h3 className="truncate text-sm font-medium first-letter:uppercase">{title}</h3>
      <Sums sums={bucket.sums} companyCurrency={currency} />
      <p className="text-xs text-muted-foreground">{t('clients:board.forecastDeals', { count: bucket.count, n: formatNumber(bucket.count) })}</p>
    </div>
  )
}

/** Open prospects by the month they are expected to close in; the last bucket holds those without a date. */
export function ForecastView({ data, currency }: { data: ForecastResponse; currency: string }) {
  return (
    <div className="space-y-3">
      <div className="kpi-grid gap-3">
        {data.months.map((entry) => (
          <Bucket key={entry.month} title={monthLabel(entry.month)} bucket={entry} currency={currency} />
        ))}
        <Bucket title={t('clients:board.noCloseDate')} bucket={data.undated} currency={currency} />
      </div>
      <p className="text-xs text-muted-foreground">{t('clients:board.overdueNote')}</p>
    </div>
  )
}
