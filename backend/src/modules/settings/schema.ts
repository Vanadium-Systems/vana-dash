import { z } from 'zod'

// Ordine + vizibilitate iteme de navigare (sprint de-hardcodare 2026-08-25) — stocat în
// dashboard_config['nav.layout']. Definiția canonică a itemelor (to/label/icon/grup) rămâne
// în cod (frontend/src/shared/lib/nav-items.ts) — config-ul ține DOAR ordinea și vizibilitatea.
export const NavLayoutEntrySchema = z.object({
  to: z.string().min(1),
  visible: z.boolean(),
})

export const NavLayoutSchema = z.array(NavLayoutEntrySchema)

export const NavLayoutResponseSchema = z.object({ items: z.array(NavLayoutEntrySchema).nullable() })

export const NavLayoutUpdateSchema = z.object({
  items: z.array(NavLayoutEntrySchema),
})

// Date firmă (pagina de referință din Setări, 2026-09-14) — stocate în dashboard_config
// ['company.profile']. Text liber peste tot: e o fișă de copiat-lipit pe la ANAF/contracte/
// formulare, nu date validate/consumate în vreo agregare — nicio constrângere de format.
export const CompanyAddressSchema = z.object({
  county: z.string(),
  city: z.string(),
  street: z.string(),
  number: z.string(),
  // Bloc/Scară/Etaj/Apartament/Birou etc. — combinație variabilă, un singur câmp liber în loc
  // de un input per variantă posibilă.
  details: z.string(),
})

export const CompanyLocationSchema = CompanyAddressSchema.extend({
  id: z.string(),
  label: z.string(),
})

export const CompanyProfileSchema = z.object({
  name: z.string(),
  cui: z.string(),
  vatIntraCode: z.string(),
  regCom: z.string(),
  caenCode: z.string(),
  capitalSocial: z.string(),
  iban: z.string(),
  bank: z.string(),
  phone: z.string(),
  email: z.string(),
  // Cifră de afaceri anuală (lei) — folosită și de jobs/tender-watch-sync.ts ca prag de
  // eligibilitate la licitații publice (Secțiunea 3 SICAP). String, ca restul fișei — se
  // parsează la citire acolo unde contează numeric.
  annualTurnoverRon: z.string(),
  registeredOffice: CompanyAddressSchema,
  workLocations: z.array(CompanyLocationSchema),
})

export type CompanyProfile = z.infer<typeof CompanyProfileSchema>

export const CompanyProfileResponseSchema = z.object({ profile: CompanyProfileSchema.nullable() })

// Kill-switch per cron operațional (2026-09-21, cerere Stefan) — stocat în dashboard_config
// ['ops_jobs.enabled']. Oprit = job-ul sare peste rularea de azi (nu doar alerta e tăcută,
// cronul chiar nu mai lovește sursa externă), util cât timp un blocaj extern (SICAP/BNR) e
// oricum cunoscut și repetarea nu ajută la nimic. Sync manual (buton dedicat) nu trece prin
// toggle-ul ăsta — rămâne mereu disponibil la cerere.
export const OpsJobTogglesSchema = z.object({
  bankSync: z.boolean(),
  tenderWatch: z.boolean(),
  bnrFeed: z.boolean(),
})

export const OpsJobTogglesUpdateSchema = OpsJobTogglesSchema.partial()

export type OpsJobToggles = z.infer<typeof OpsJobTogglesSchema>
