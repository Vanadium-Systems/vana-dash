import { eq } from 'drizzle-orm'
import { db, sql } from '../shared/db/client.js'
import { pricingConfigs } from '../shared/db/schema/index.js'

// One-off run: moves the 12 fixed `addon*Price` fields of `pricing_configs.config` into a
// generic array `addons: [{key, label, price}]`. The keys are exactly the values of the
// `addons` enum of `SelfServePricingCalculateSchema` (modules/vanagreen-ingest/schema.ts),
// which is a fixed contract with the VanaGreen signup wizard, so no new vocabulary is made up.
//
// ADITIV, NU distructiv: câmpurile `addon*Price` vechi RĂMÂN în jsonb — Zod non-strict le
// ignoră silențios la citire (`PricingConfigSchema` nu declară `.strict()`). Asta face scriptul
// safe de rulat înainte SAU după deploy-ul codului nou (schema.ts/calc.ts), fără fereastră de
// downtime pe self-serve/calculator în timp ce push-ul auto-deploy e în tranzit.

const ADDON_LABELS: Record<string, string> = {
  treatment: 'Tratări',
  pickup: 'Programări',
  market_prices: 'Prețuri pe piață',
  nexus: 'Nexus',
  crm: 'CRM',
  accounting: 'e-Factura',
  signature_pad: 'Semnătură digitală',
  id_scanner: 'Scanner buletine',
  analytics: 'Analytics/BI',
  partner_portal: 'Portal parteneri',
  hr: 'Modul HR',
  ai_assistant: 'VanaGreen AI',
}

const OLD_FIELD_BY_KEY: Record<string, string> = {
  treatment: 'addonTratariPrice',
  pickup: 'addonProgramariPrice',
  market_prices: 'addonPreturiPietePrice',
  nexus: 'addonNexusPrice',
  crm: 'addonCrmPrice',
  accounting: 'addonEfacturaPrice',
  signature_pad: 'addonSemnaturaDigitalaPrice',
  id_scanner: 'addonScannerBuletinePrice',
  analytics: 'addonAnalyticsPrice',
  partner_portal: 'addonPartnerPortalPrice',
  hr: 'addonHrPrice',
  ai_assistant: 'addonAiAssistantPrice',
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const rows = await db.select().from(pricingConfigs)
  console.log(`[migrate-pricing-addons] ${rows.length} rânduri pricing_configs găsite${dryRun ? ' (DRY RUN)' : ''}`)

  let migrated = 0
  let skipped = 0

  for (const row of rows) {
    const config = row.config as Record<string, unknown>
    if (Array.isArray(config.addons)) {
      console.log(`[migrate-pricing-addons] platformId=${row.platformId} — deja are "addons", sărit`)
      skipped++
      continue
    }

    const addons = Object.entries(OLD_FIELD_BY_KEY)
      .filter(([, field]) => typeof config[field] === 'number')
      .map(([key, field]) => ({ key, label: ADDON_LABELS[key], price: config[field] as number }))

    console.log(
      `[migrate-pricing-addons] platformId=${row.platformId} — ${dryRun ? 'AR ADĂUGA' : 'adaug'} addons: ${JSON.stringify(addons)}`,
    )

    if (!dryRun) {
      await db
        .update(pricingConfigs)
        .set({ config: { ...config, addons }, updatedAt: new Date() })
        .where(eq(pricingConfigs.id, row.id))
    }
    migrated++
  }

  console.log(`[migrate-pricing-addons] gata — ${dryRun ? 'ar migra' : 'migrate'}: ${migrated}, deja migrate: ${skipped}, total: ${rows.length}`)
}

main()
  .catch((err) => {
    console.error('[migrate-pricing-addons] eșuat:', err)
    process.exitCode = 1
  })
  .finally(() => sql.end())
