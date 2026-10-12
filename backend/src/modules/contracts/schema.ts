import { z } from 'zod'

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

// Coordonate normalizate 0..1 față de pagină (independent de zoom-ul din UI la desenare) — tab
// „Semnează", 2026-09-03.
export const SignatureRectSchema = z.object({
  page: z.number().int().min(1),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
})

// Numere de contract ocupate în afara dash-ului (PLAN.md C0): generatorul de sugestii le sare.
export const ReservedNumberSchema = z.object({
  number: z
    .string()
    .trim()
    .regex(/^\d{1,4}$/)
    .transform((v) => v.padStart(3, '0')),
  note: z.string().trim().min(1).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})
export const ReservedNumbersSchema = z.array(ReservedNumberSchema)
export type ReservedNumber = z.infer<typeof ReservedNumberSchema>
