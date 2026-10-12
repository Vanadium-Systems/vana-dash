import { useSearchParams } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'

const PERIODS = [
  { value: '7d', label: '7 zile' },
  { value: '30d', label: '30 zile' },
  { value: '90d', label: '90 zile' },
  { value: 'mtd', label: 'Luna curentă' },
  { value: 'ytd', label: 'Anul curent' },
] as const

// Perioada trăiește în URL (?period=), nu în useState — regula din CLAUDE.md.
export function usePeriod(): string {
  const [searchParams] = useSearchParams()
  return searchParams.get('period') ?? '30d'
}

export function PeriodSelector() {
  const [searchParams, setSearchParams] = useSearchParams()
  const current = searchParams.get('period') ?? '30d'

  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {PERIODS.map((p) => (
        <Button
          key={p.value}
          variant={current === p.value ? 'default' : 'outline'}
          className="shrink-0"
          onClick={() => {
            const next = new URLSearchParams(searchParams)
            next.set('period', p.value)
            setSearchParams(next)
          }}
        >
          {p.label}
        </Button>
      ))}
    </div>
  )
}
