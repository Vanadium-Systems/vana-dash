import { Card, CardContent } from '@/shared/components/ui/card'
import type { SignalLevel } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { t } from '@/shared/lib/i18n'

const LEVEL_DOT: Record<SignalLevel, string> = {
  green: 'bg-success',
  yellow: 'bg-warning',
  red: 'bg-destructive',
}

const LEVEL_LABEL: Record<SignalLevel, string> = {
  green: t('common:actions.ok'),
  yellow: t('common:states.warning'),
  red: t('common:states.critical'),
}

export interface SignalTileData {
  key: string
  label: string
  level: SignalLevel
  value: number | null
  unit: 'pct' | 'count' | 'hours' | 'queued'
  detail: string
}

/**
 * Componentă comună — folosită atât de „Sănătate sistem" (server vana-dash propriu,
 * `modules/monitoring/`) cât și de panoul „Sănătate" per platformă (server extern, Platforms).
 */
export function SignalTile({ signal }: { signal: SignalTileData }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">{signal.label}</span>
          <span className={cn('h-2.5 w-2.5 rounded-full', LEVEL_DOT[signal.level])} title={LEVEL_LABEL[signal.level]} />
        </div>
        <div className="mt-2 text-2xl font-bold">
          {signal.value === null
            ? '—'
            : signal.unit === 'pct'
              ? `${signal.value.toFixed(1)}%`
              : signal.unit === 'hours'
                ? `${signal.value.toFixed(1)}h`
                : signal.value}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{signal.detail}</p>
      </CardContent>
    </Card>
  )
}
