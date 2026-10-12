import { StatePill, type StateTone } from '@/shared/components/ui/state-pill'
import type { HealthStatus } from '@/shared/lib/types'
import { t } from '@/shared/lib/i18n'

const config: Record<HealthStatus, { label: string; tone: StateTone }> = {
  healthy: { label: t('common:platformStatus.healthy'), tone: 'success' },
  degraded: { label: t('common:platformStatus.degraded'), tone: 'warning' },
  down: { label: t('common:platformStatus.down'), tone: 'critical' },
  unknown: { label: t('common:states.unknown'), tone: 'neutral' },
}

export function PlatformStatusBadge({ status }: { status: HealthStatus }) {
  const { label, tone } = config[status] ?? config.unknown
  return <StatePill tone={tone}>{label}</StatePill>
}
