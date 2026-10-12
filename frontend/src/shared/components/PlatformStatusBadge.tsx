import { StatePill, type StateTone } from '@/shared/components/ui/state-pill'
import type { HealthStatus } from '@/shared/lib/types'

const config: Record<HealthStatus, { label: string; tone: StateTone }> = {
  healthy: { label: 'Funcțional', tone: 'success' },
  degraded: { label: 'Degradat', tone: 'warning' },
  down: { label: 'Căzut', tone: 'critical' },
  unknown: { label: 'Necunoscut', tone: 'neutral' },
}

export function PlatformStatusBadge({ status }: { status: HealthStatus }) {
  const { label, tone } = config[status] ?? config.unknown
  return <StatePill tone={tone}>{label}</StatePill>
}
