import { useSearchParams } from 'react-router-dom'
import { Select } from '@/shared/components/ui/select'
import { t } from '@/shared/lib/i18n'

const PERIODS = [
  { value: '7d', label: t('common:labels.days7') },
  { value: '30d', label: t('common:labels.days30') },
  { value: '90d', label: t('common:labels.days90') },
  { value: 'mtd', label: t('common:period.currentMonth') },
  { value: 'ytd', label: t('common:period.currentYear') },
]

// Perioada trăiește în URL (?period=), nu în useState — regula din CLAUDE.md.
export function usePeriod(): string {
  const [searchParams] = useSearchParams()
  return searchParams.get('period') ?? '30d'
}

export function PeriodSelector() {
  const [searchParams, setSearchParams] = useSearchParams()
  const current = searchParams.get('period') ?? '30d'

  return (
    <Select
      className="w-auto"
      aria-label={t('common:period.label')}
      options={PERIODS}
      value={current}
      onValueChange={(period) => {
        const next = new URLSearchParams(searchParams)
        next.set('period', period)
        setSearchParams(next)
      }}
    />
  )
}
