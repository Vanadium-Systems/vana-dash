import { z } from 'zod'
import { CONTRACT_TEMPLATE_KEYS } from '../../shared/lib/contract-template-bodies.js'
import { lazyTr } from '../../shared/lib/i18n.js'

export const TemplateKeyParamsSchema = z.object({ key: z.enum(CONTRACT_TEMPLATE_KEYS) })

// bodyHtml e HTML de încredere (randat în PDF doar pt. Stefan autentificat); valorile
// per-client injectate prin tokeni trec prin esc() în motorul din contract-templates.ts.
export const TemplateUpdateSchema = z.object({
  bodyHtml: z.string().min(1),
})

const termValue = z.string().trim().min(1)
export const ContractTermsUpdateSchema = z
  .object({
    penalitateIntarziere: termValue.optional(),
    termenScadenta: termValue.optional(),
    gratiePlata: termValue.optional(),
    preavizReziliere: termValue.optional(),
    termenConfirmareContinuare: termValue.optional(),
    lunaGratuitaDurata: termValue.optional(),
    referralReducere: termValue.optional(),
    referralDurata: termValue.optional(),
    referralPlafon: termValue.optional(),
    slaUptime: termValue.optional(),
    slaMentenanta: termValue.optional(),
    slaP1: termValue.optional(),
    slaP2: termValue.optional(),
  })
  .refine((input) => Object.keys(input).length > 0, { message: lazyTr('errors.contracts.atLeastOneTerm') })
