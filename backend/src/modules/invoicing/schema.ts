import { z } from 'zod'
import { lazyTr, tr } from '../../shared/lib/i18n.js'
import { updateSchema } from '../../shared/lib/update-schema.js'

// Sprint C, Track D — slug: identificator uman-lizibil comun cu vanagreen (tenants.slug
// acolo). kebab-case, generat din name dacă lipsește la creare (vezi routes.ts).
const slugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, lazyTr('errors.invoicing.slugKebab'))

export const ClientCreateSchema = z.object({
  name: z.string().min(1),
  slug: slugSchema.optional(),
  cif: z.string().min(2).max(13),
  regCom: z.string().optional(),
  address: z.string().min(1),
  city: z.string().optional(),
  county: z.string().optional(),
  country: z.string().length(2).default('RO'),
  iban: z.string().optional(),
  bank: z.string().optional(),
  email: z.string().email().optional(),
  // Sprint C, Track B — mapare la un tenant vanagreen (recyclers_app) + facturare
  // automată. vanagreenTenantId e validat printr-un apel API (verify-tenant), nu FK.
  vanagreenTenantId: z.string().min(1).nullable().optional(),
  // Re-scope 2026-07-18 — aplicația integrată căreia îi aparține clientul, determină ce
  // template-uri de factură (modules/invoicing) sunt disponibile la facturare. Null = client
  // nemapat la nicio platformă (facturare strict manuală).
  platformId: z.string().uuid().nullable().optional(),
  vanagreenExtendMonths: z.number().int().min(1).max(60).nullable().optional(),
  subscriptionPriceLei: z.number().min(0).max(99_999_999).nullable().optional(),
  subscriptionPriceEur: z.number().min(0).max(99_999_999).nullable().optional(),
  subscriptionPriceCurrency: z.enum(['lei', 'eur']).optional(),
  autoInvoiceEnabled: z.boolean().optional(),
  // Sprint C, Track D — cadență de facturare recurentă (mutată din vanagreen, vezi
  // jobs/billing-cycle-rollover.ts). billingCycle null = mod one-shot (billingDueDate setat
  // manual, nu se rostogolește automat).
  needsBillingInfo: z.boolean().optional(),
  billingCycle: z.enum(['monthly', 'annual']).nullable().optional(),
  billingCycleDay: z.number().int().min(1).max(28).nullable().optional(),
  billingCycleMonth: z.number().int().min(1).max(12).nullable().optional(),
  billingDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  // Excepție per client de la termenul de plată implicit (SequenceUpdateSchema.defaultPaymentTermsDays)
  // — null = folosește default-ul global (vezi billing-clients.ts).
  paymentTermsDays: z.number().int().min(0).max(365).nullable().optional(),
  // Sprint Tab Contracte (2026-08-01) — câmpuri specifice generării de contract, citite de
  // modules/contracts/. Scrise AICI (invoicing rămâne singurul writer pe billing_clients,
  // regula de izolare CLAUDE.md #5) — contractDetails e jsonb liber, shape-ul lui e validat
  // separat, la citire, de ContractDetailsSchema din modules/contracts/schema.ts (nu aici, ca
  // să nu creeze un import invoicing → contracts).
  contactName: z.string().trim().max(255).nullable().optional(),
  contactTitle: z.string().trim().max(255).nullable().optional(),
  phone: z.string().trim().max(100).nullable().optional(),
  contractPlan: z.string().trim().max(100).nullable().optional(),
  contractDetails: z.record(z.string(), z.unknown()).nullable().optional(),
})

export const ClientUpdateSchema = updateSchema(ClientCreateSchema)

// Doar pt. POST /api/invoicing/clients — flag tranzitoriu, NU o coloană pe billing_clients.
// Dacă bifat, ruta creează mai întâi tenant-ul în vanagreen (POST /tenants), apoi salvează
// clientul local cu vanagreenTenantId populat din răspuns. Default OFF — nu toți clienții au
// legătură cu vanagreen.
export const ClientCreateWithVanagreenSchema = ClientCreateSchema.extend({
  createInVanagreen: z.boolean().optional(),
})

export const IdParamsSchema = z.object({ id: z.string().uuid() })

export const InvoiceLineSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
  vatRate: z.number().min(0).max(100).default(0),
})
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>

export const InvoiceCreateSchema = z.object({
  billingClientId: z.string().uuid(),
  // Sprint D, Track 3 — dacă prezent, serverul copiază lineItems/currency din template ca
  // valori inițiale (draft-ul rămâne editabil, nu e un link viu la template). `lines` rămâne
  // opțional aici (nu `.min(1)`) ca să poată lipsi când vine dintr-un template — serviciul
  // impune "cel puțin o sursă" (template SAU lines), nu schema.
  templateId: z.string().uuid().optional(),
  // Fără `.default('RON')` intenționat — un default aplicat de zod ar masca "clientul n-a
  // trimis currency" și ar suprascrie moneda template-ului. Default-ul 'RON' se aplică în
  // service.ts, DOAR dacă nici input, nici template nu dau o monedă.
  currency: z.string().length(3).optional(),
  issuedAt: z.coerce.date().optional(),
  dueAt: z.coerce.date().optional(),
  note: z.string().optional(),
  lines: z.array(InvoiceLineSchema).optional(),
})

// Doar draft-urile se pot edita (înainte de alocarea numărului).
export const InvoiceUpdateSchema = updateSchema(InvoiceCreateSchema)

export const SequenceUpdateSchema = z.object({
  prefix: z.string().max(10).optional(),
  separator: z.string().max(3).optional(),
  yearFormat: z.enum(['none', 'yy', 'yyyy']).optional(),
  padding: z.number().int().min(0).max(10).optional(),
  startFrom: z.number().int().min(1).optional(),
  resetOn: z.enum(['never', 'year']).optional(),
  defaultPaymentTermsDays: z.number().int().min(0).max(365).optional(),
})

// ── Template-uri de facturi per client (Sprint D, Track 3) ──────────────────────

// `priceSource: 'client_subscription'` — prețul liniei NU vine din `unitPrice` (poate rămâne
// null în template), ci se rezolvă la momentul generării facturii din subscriptionPriceLei/Eur
// al clientului, convertit dacă e nevoie la moneda facturii (curs BNR din ziua emiterii — vezi
// resolveTemplateLines în service.ts). Util pt. template-ul "Abonament" marcat implicit: dacă
// Stefan schimbă prețul clientului, factura automată următoare îl reflectă fără să umble la
// template.
export const InvoiceTemplateLineSchema = z
  .object({
    description: z.string().min(1),
    quantity: z.number().positive(),
    priceSource: z.enum(['fixed', 'client_subscription']).default('fixed'),
    unitPrice: z.number().nonnegative().nullable().default(null),
    vatRatePct: z.number().min(0).max(100).default(0),
  })
  .superRefine((line, ctx) => {
    if (line.priceSource === 'fixed' && line.unitPrice === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: tr('errors.invoicing.unitPriceRequired'),
        path: ['unitPrice'],
      })
    }
  })
export type InvoiceTemplateLine = z.infer<typeof InvoiceTemplateLineSchema>

export const InvoiceTemplateCreateSchema = z.object({
  name: z.string().min(1),
  currency: z.enum(['RON', 'EUR', 'USD']).default('RON'),
  lineItems: z.array(InvoiceTemplateLineSchema).min(1),
  isDefaultForAutoInvoice: z.boolean().optional(),
})

export const InvoiceTemplateUpdateSchema = updateSchema(InvoiceTemplateCreateSchema)

export const ClientIdParamsSchema = z.object({ clientId: z.string().uuid() })
export const CifParamsSchema = z.object({ cif: z.string().min(2).max(15) })

// Sprint D, Track 3, re-scope 2026-07-18 — template-urile aparțin unei platforme (aplicație
// integrată), nu unui client. 2-3 template-uri per platformă, reutilizate de toți clienții ei.
export const PlatformIdParamsSchema = z.object({ platformId: z.string().uuid() })
export const PlatformTemplateIdParamsSchema = z.object({ platformId: z.string().uuid(), id: z.string().uuid() })

// Preview pt. un client anume (rezolvă liniile "din abonamentul clientului" cu prețul LUI curent).
export const ClientTemplateResolveParamsSchema = z.object({ clientId: z.string().uuid(), id: z.string().uuid() })

// Query opțional pt. GET .../templates/:id/resolve — dacă lipsește, se rezolvă în moneda
// proprie a template-ului (vezi service.resolveClientTemplateLines).
export const TemplateResolveQuerySchema = z.object({ currency: z.enum(['RON', 'EUR', 'USD']).optional() })

// Preț introdus într-o valută diferită de moneda facturii (ex: 200 EUR pe o factură RON) —
// InvoiceFormDialog cere cursul BNR ca să calculeze unitPrice-ul în moneda facturii, fără să
// pună povara conversiei pe Stefan. `date` implicit azi (curs cel mai recent publicat).
export const ExchangeRateLookupQuerySchema = z.object({
  currency: z.enum(['EUR', 'USD']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})
