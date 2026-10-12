export const TIER_LABELS: Record<number, string> = {
  1: 'Tier 1 — Operațional',
  2: 'Tier 2 — Achiziție',
  3: 'Tier 3 — Retenție',
  4: 'Tier 4 — Cash cow / Prestige',
}

export function tierLabel(tier: number): string {
  return TIER_LABELS[tier] ?? `Tier ${tier}`
}
