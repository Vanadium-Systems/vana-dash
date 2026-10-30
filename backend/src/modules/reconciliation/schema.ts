import { z } from 'zod'
import { updateSchema } from '../../shared/lib/update-schema.js'

export const BankAccountCreateSchema = z.object({
  provider: z.string().min(1),
  name: z.string().min(1),
  accountRef: z.string().optional(),
  currency: z.string().length(3).default('RON'),
  // Write-only: intră aici, se criptează, nu mai iese niciodată. Opțional —
  // provideri OAuth (Revolut) nu au niciun key static la creare, se configurează
  // separat (client_id + certificat + consimțire, tab Setări). Rămâne obligatoriu
  // doar pentru provideri viitori pe token static (validat în service, nu aici).
  apiKey: z.string().min(1).optional(),
})

// clientId e plain (nu secret) — alocat de Revolut la înregistrarea aplicației,
// setat separat de generarea certificatului / consimțirea OAuth.
export const BankAccountUpdateSchema = updateSchema(BankAccountCreateSchema).extend({
  clientId: z.string().min(1).optional(),
})

export const IdParamsSchema = z.object({ id: z.string().uuid() })

// Codul OAuth primit de la Revolut după consimțirea în browser (per cont, nu global ca la ANAF).
export const RevolutExchangeCodeSchema = z.object({
  code: z.string().min(1),
})

export const TransactionsQuerySchema = z.object({
  accountId: z.string().uuid().optional(),
  // z.coerce.boolean() ar transforma string-ul "false" în true — parsăm explicit.
  unmatchedOnly: z.preprocess((v) => v === true || v === 'true', z.boolean()).default(false),
  direction: z.enum(['in', 'out']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
})

export const MatchCreateSchema = z.object({
  financialRecordId: z.string().uuid(),
})

// Sprint C, Track B — extindere abonament vanagreen.
export const VanagreenSettingsUpdateSchema = z.object({
  autoExtendEnabled: z.boolean(),
})

export const VerifyVanagreenTenantSchema = z.object({
  tenantId: z.string().min(1),
})
