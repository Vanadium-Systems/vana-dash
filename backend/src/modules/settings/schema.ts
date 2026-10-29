import { z } from 'zod'
import { CompanyProfileSchema } from '../../shared/lib/company.js'

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

// The company sheet: schema and storage in shared/lib/company.ts, read by invoices, declarations
// and contracts. Only the country stays out of the body: one pack exists, so it is shown, not chosen.
export { CompanyProfileSchema } from '../../shared/lib/company.js'

export const CompanySettingsUpdateSchema = z.object({
  profile: CompanyProfileSchema,
  timeZone: z.string().min(1),
  currency: z.string(),
})

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
