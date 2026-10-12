import { z } from 'zod'
import { ASSISTANT_PROVIDER_IDS } from './providers/types.js'

export const ProviderIdParamsSchema = z.object({ provider: z.enum(ASSISTANT_PROVIDER_IDS) })

// apiKey e write-only: intră, se criptează, nu mai iese niciodată (doar preview masked în GET).
export const ProviderUpdateSchema = z
  .object({
    apiKey: z.string().trim().min(1).optional(),
    baseUrl: z.string().trim().optional(),
    models: z
      .array(
        z.object({
          id: z.string().trim().min(1),
          label: z.string().trim().min(1),
          // pt. meter-ul de context din UI — opționale, modelele vechi rămân valide
          contextWindow: z.number().int().positive().max(10_000_000).optional(),
          inputPricePerMtok: z.number().nonnegative().optional(),
          outputPricePerMtok: z.number().nonnegative().optional(),
        }),
      )
      .min(1)
      .optional(),
    defaultModel: z.string().trim().optional(),
    enabled: z.boolean().optional(),
    isDefault: z.boolean().optional(),
  })
  .refine((input) => Object.keys(input).length > 0, { message: 'Trimite cel puțin un câmp' })
