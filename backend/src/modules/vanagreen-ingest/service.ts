import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { billingClients, dashboardConfig } from '../../shared/db/schema/index.js'
import { calculatePrice } from '../pricing/calc.js'
import type { PricingCalculateInput, PricingConfig } from '../pricing/schema.js'
import * as pricingService from '../pricing/service.js'
import { getVanagreenPlatformConfig } from '../reconciliation/vanagreen-extension.js'
import type { SelfServeBillingClientIngestBody, SelfServePricingCalculateInput } from './schema.js'

const TOGGLE_KEY = 'vanagreen_selfserve_pricing_enabled'

/**
 * Kill-switch cerut de Stefan (2026-08-04) — implicit ON (spre deosebire de
 * `vanagreen_auto_extend_enabled`, care e implicit OFF): rândul lipsește din `dashboard_config`
 * până la primul toggle explicit, iar wizard-ul self-serve din recyclers_app trebuie să
 * funcționeze din prima, nu să pară "oprit" fără ca Stefan să fi atins vreodată setarea.
 */
export async function isSelfServePricingEnabled(): Promise<boolean> {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, TOGGLE_KEY))
  return row ? Boolean(row.value) : true
}

export async function setSelfServePricingEnabled(enabled: boolean): Promise<void> {
  await db
    .insert(dashboardConfig)
    .values({ key: TOGGLE_KEY, value: enabled })
    .onConflictDoUpdate({ target: dashboardConfig.key, set: { value: sql`excluded.value`, updatedAt: new Date() } })
}

/**
 * Mapare de la vocabularul public al wizard-ului (contract fix, recyclers_app) la shape-ul
 * intern al calculatorului (`modules/pricing/calc.ts`) — self-serve nu oferă echipamente fizice
 * (negociate manual ulterior de Stefan), deci `selectedEquipmentIds` rămâne []. Wave 0/1, sprint
 * de-hardcodare (2026-08-20): `body.addons` trece acum DIRECT în `selectedAddonKeys` — catalogul
 * intern de add-on-uri (`pricing_configs.config.addons[].key`, migrat de
 * `scripts/migrate-pricing-addons.ts`) folosește EXACT vocabularul enum-ului `addons` de mai sus
 * ca `key`, deci nu mai e nevoie de o mapare 1:1 pe câmpuri booleene numite.
 */
function toCalcInput(body: SelfServePricingCalculateInput): PricingCalculateInput {
  return {
    platformId: '', // neutilizat de calculatePrice — doar getConfig() mai sus are nevoie de el
    flux: body.flavor === 'deee_dba' ? 'deee' : 'standard',
    opDesktop: body.desktopOperators,
    opMobil: body.mobileSeats,
    puncte: body.workPoints,
    documente: body.documentsPerMonth,
    siatd: body.siatdPurchasesPerMonth,
    selectedEquipmentIds: [],
    selectedAddonKeys: body.addons,
    selectedBundleKey: body.bundle,
    addonQuantities: body.addonQuantities,
    cantare: body.cantare,
  }
}

/**
 * Catalogul de pachete al platformei VanaGreen — expus prin GET /pricing/bundles ca
 * recyclers_app să poată popula wizard-ul dinamic (pachetele sunt definite liber de Stefan din
 * Config preț, NU un enum fix ca `addons`). Array gol dacă platforma nu e configurată încă sau
 * n-are niciun pachet definit — nu 404/503, wizard-ul pur și simplu nu arată opțiunea.
 */
export async function listSelfServeBundles() {
  const platform = await getVanagreenPlatformConfig()
  if (!platform) return []
  const configRow = await pricingService.getConfig(platform.id)
  return configRow?.config.bundles ?? []
}

export interface SelfServeQuote {
  totalMonthly: number
  totalAnnual: number
  onboardingTotal: number | null
  currency: 'EUR'
}

/**
 * Null = "preț indisponibil" — kill-switch OFF, platforma vanagreen neconfigurată, niciun
 * pricing_config salvat încă pt. ea, SAU `documentsPerMonth` depășește ultima bandă calculabilă
 * automat (`manualReviewNeeded`, vezi calc.ts docOverage) — un total parțial ar subestima real
 * prețul pt. volum foarte mare de documente, mai sigur să ceară contact direct decât să arate o
 * cifră greșită. Ruta (routes.ts) traduce null în non-2xx: recyclers_app tratează deja orice
 * non-2xx ca fallback grațios (vanadash-pricing-client.ts), deci toate cazurile de mai sus
 * reutilizează exact același path, fără cod de eroare nou pe partea de recyclers_app.
 */
export async function calculateSelfServeQuote(body: SelfServePricingCalculateInput): Promise<SelfServeQuote | null> {
  if (!(await isSelfServePricingEnabled())) return null

  const platform = await getVanagreenPlatformConfig()
  if (!platform) return null

  const configRow = await pricingService.getConfig(platform.id)
  if (!configRow) return null

  const result = calculatePrice(configRow.config as PricingConfig, toCalcInput(body))
  if (result.manualReviewNeeded) return null

  return {
    totalMonthly: result.totalMonthly,
    totalAnnual: result.totalAnnual,
    onboardingTotal: body.includeOnboarding ? result.onboardingTotal : null,
    currency: 'EUR',
  }
}

/**
 * Idempotent pe `vanagreenTenantId` (același pattern ca `jobs/vanagreen-tenant-sync.ts`) — un
 * retry din recyclers_app (backoff 1s/2s/3s) sau o redeschidere a wizard-ului nu trebuie să
 * creeze un al doilea `billing_client` schelet pt. același tenant.
 *
 * CIF/adresă rămân placeholder gol (NOT NULL la nivel DB) — needsBillingInfo:true semnalează
 * explicit în UI, Stefan le completează manual la conversie trial→plătit (100% manuală, ca
 * restul fluxului vanagreen). `quotedAnnualTotal` nu se persistă separat — derivabil din
 * `subscriptionPriceLei × lunileAnuale` din config-ul de preț, nu justifică o coloană nouă.
 */
export async function createSelfServeBillingClient(body: SelfServeBillingClientIngestBody) {
  const [existing] = await db
    .select()
    .from(billingClients)
    .where(and(eq(billingClients.vanagreenTenantId, body.vanagreenTenantId), isNull(billingClients.deletedAt)))
  if (existing) return existing

  const platform = await getVanagreenPlatformConfig()

  const [row] = await db
    .insert(billingClients)
    .values({
      name: body.companyName,
      email: body.contactEmail,
      vanagreenTenantId: body.vanagreenTenantId,
      platformId: platform?.id ?? null,
      needsBillingInfo: true,
      autoInvoiceEnabled: false,
      subscriptionPriceLei: body.quotedMonthlyTotal === null ? null : String(body.quotedMonthlyTotal),
      subscriptionPriceCurrency: 'lei',
      cif: '',
      address: '',
    })
    .returning()
  if (!row) throw new Error('Creare billing_client self-serve eșuată')
  return row
}
