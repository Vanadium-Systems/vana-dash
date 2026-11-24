import { z } from 'zod'
import { PricingCalculateSchema } from '../pricing/schema.js'

// The contract fields with no column of their own on billing_clients (contactName,
// contactTitle, phone and contractPlan are columns). They are free text specific to one
// contract, stored as jsonb and validated here, like pricing_configs.config.
export const ContractDetailsSchema = z.object({
  nrContract: z.string().trim().min(1).optional(),
  dataContract: z.string().trim().min(1).optional(),
  taxaInitiere: z.string().trim().min(1).optional(),
  nrZileOnboarding: z.string().trim().min(1).optional(),
  facturareTip: z.string().trim().min(1).optional(),
  operatoriGestiune: z.string().trim().optional(),
  operatoriTeren: z.string().trim().optional(),
  puncteLucru: z.string().trim().optional(),
  documenteIncluse: z.string().trim().optional(),
  flux: z.string().trim().optional(),
  moduleAddon: z.string().trim().optional(),
  // Implicit true (nesetat = comportamentul de dinainte, Luna Gratuită inclusă) — bifă explicită
  // de „fals" pt. clienții fără Lună Gratuită (2026-09-21). Vezi contract-templates.ts.
  areLunaGratuita: z.boolean().optional(),
  conditiiSpeciale: z.string().trim().optional(),
  // The calculator inputs the price came from, saved by "apply to client" so the quote can be reopened.
  calc: PricingCalculateSchema.optional(),
})
export type ContractDetails = z.infer<typeof ContractDetailsSchema>

export const GenerateDocumentSchema = z.object({
  docType: z.enum(['contract', 'anexa']),
})

export const MarkDocumentSignedSchema = z.object({
  isSigned: z.boolean(),
})

export const CreateAddendumSchema = z.object({
  issuedAt: z.string().trim().min(1),
  oldPriceNote: z.string().trim().min(1),
  newPriceNote: z.string().trim().min(1),
  reason: z.string().trim().min(1),
  effectiveDateNote: z.string().trim().min(1),
  temporary: z.boolean().default(false),
  reversionNote: z.string().trim().min(1).optional(),
})

export const ClientIdParamsSchema = z.object({ clientId: z.string().uuid() })
export const DocumentIdParamsSchema = z.object({ id: z.string().uuid() })
export const AddendumIdParamsSchema = z.object({ id: z.string().uuid() })

