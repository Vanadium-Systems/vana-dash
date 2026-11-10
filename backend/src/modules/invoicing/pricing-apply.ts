import { z } from 'zod'
import { PricingCalculateSchema } from '../pricing/schema.js'

// Schema-only import from pricing/: the calculator inputs are saved as-is in contract_details.calc,
// so the shape must be the one the calculator validates.
export const CalcInputsSchema = PricingCalculateSchema

// The contract stores these as free text; the calculator hands over numbers for some of them.
const detailText = z.union([z.string(), z.number()]).transform((v) => String(v).trim())

export const PricingDetailsSchema = z.object({
  moduleAddon: detailText.optional(),
  operatoriGestiune: detailText.optional(),
  operatoriTeren: detailText.optional(),
  puncteLucru: detailText.optional(),
  taxaInitiere: detailText.optional(),
})

export const ClientPricingSchema = z.object({
  subscriptionPriceEur: z.number().min(0).max(99_999_999),
  contractPlan: z.string().trim().max(100).nullable(),
  details: PricingDetailsSchema,
  calc: CalcInputsSchema,
})
export type ClientPricingInput = z.infer<typeof ClientPricingSchema>

export interface PricingChange {
  field: string
  from: string | null
  to: string | null
}

const DETAIL_FIELDS = ['moduleAddon', 'operatoriGestiune', 'operatoriTeren', 'puncteLucru', 'taxaInitiere'] as const

// A signed contract needs an addendum when what the client pays or gets changes; the setup fee
// and the plan label do not.
const ADDENDUM_FIELDS = new Set(['subscriptionPriceEur', 'details.moduleAddon', 'details.operatoriGestiune', 'details.operatoriTeren', 'details.puncteLucru'])

interface CurrentPricing {
  subscriptionPriceEur: string | null
  contractPlan: string | null
  contractDetails: unknown
}

export function planPricingApply(current: CurrentPricing, input: ClientPricingInput, hasSignedContract: boolean) {
  // Unknown keys already in the jsonb stay: only the fields below are overwritten.
  const existing = (current.contractDetails ?? {}) as Record<string, unknown>
  const changes: PricingChange[] = []

  const oldPrice = current.subscriptionPriceEur === null ? null : Number(current.subscriptionPriceEur)
  if (oldPrice !== input.subscriptionPriceEur) {
    changes.push({
      field: 'subscriptionPriceEur',
      from: oldPrice === null ? null : String(oldPrice),
      to: String(input.subscriptionPriceEur),
    })
  }
  if (current.contractPlan !== input.contractPlan) {
    changes.push({ field: 'contractPlan', from: current.contractPlan, to: input.contractPlan })
  }

  const contractDetails: Record<string, unknown> = { ...existing }
  for (const field of DETAIL_FIELDS) {
    const next = input.details[field]
    if (next === undefined) continue
    const prev = typeof existing[field] === 'string' ? (existing[field] as string) : null
    if (prev !== next) changes.push({ field: `details.${field}`, from: prev, to: next })
    contractDetails[field] = next
  }
  contractDetails.calc = input.calc

  return {
    changes,
    contractDetails,
    needsAddendum: hasSignedContract && changes.some((c) => ADDENDUM_FIELDS.has(c.field)),
  }
}
