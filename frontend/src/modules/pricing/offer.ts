import type { PricingCalculateInput, PricingConfig, PricingResult } from '@/shared/lib/types'

/** Body of `PATCH /api/invoicing/clients/:id/pricing` and `PUT /api/prospects/:id/offer` (invoicing/pricing-apply.ts). */
export interface PricingApplyBody {
  subscriptionPriceEur: number
  contractPlan: string | null
  details: {
    moduleAddon: string
    operatoriGestiune: string
    operatoriTeren: string
    puncteLucru: string
    taxaInitiere: string
  }
  calc: PricingCalculateInput
}

export interface StoredOffer extends PricingApplyBody {
  savedAt: string
}

export interface PricingChange {
  field: string
  from: string | null
  to: string | null
}

export interface PricingPreview {
  changes: PricingChange[]
  needsAddendum: boolean
}

/** Bundle first, then the extra add-ons; a banded add-on carries its quantity. */
function moduleText(config: PricingConfig, input: PricingCalculateInput): string {
  const bundle = config.bundles.find((b) => b.key === input.selectedBundleKey)
  const inBundle = new Set(bundle?.addonKeys ?? [])
  const addons = config.addons
    .filter((addon) => input.selectedAddonKeys.includes(addon.key) && !inBundle.has(addon.key))
    .map((addon) => (addon.bands?.length ? `${addon.label} (${input.addonQuantities?.[addon.key] ?? 1})` : addon.label))
  return [bundle?.label, ...addons].filter(Boolean).join(', ')
}

export function buildApplyBody(config: PricingConfig, input: PricingCalculateInput, result: PricingResult): PricingApplyBody {
  return {
    subscriptionPriceEur: result.totalMonthly,
    contractPlan: result.planName,
    details: {
      moduleAddon: moduleText(config, input),
      operatoriGestiune: String(input.opDesktop),
      operatoriTeren: String(input.opMobil),
      puncteLucru: String(input.puncte),
      // The contract template prints this field as written.
      taxaInitiere: `${result.onboardingTotal} EUR`,
    },
    calc: input,
  }
}
