import { t } from '@/shared/lib/i18n'
export const TIER_LABELS: Record<number, string> = {
  1: t('plan:tiers.operational'),
  2: t('plan:tiers.acquisition'),
  3: t('plan:tiers.retention'),
  4: t('plan:tiers.cashCow'),
}

export function tierLabel(tier: number): string {
  return TIER_LABELS[tier] ?? `Tier ${tier}`
}
