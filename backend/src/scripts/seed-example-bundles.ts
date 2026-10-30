import { eq } from 'drizzle-orm'
import { db, sql } from '../shared/db/client.js'
import { PricingConfigSchema } from '../modules/pricing/schema.js'
import { platforms, pricingConfigs } from '../shared/db/schema/index.js'

// Rulare UNICĂ — 5 bundle-uri exemplu propuse lui Stefan (2026-08-20), pe platforma VanaGreen.
// Upsert pe `key`: dacă rulezi de două ori, actualizează rândurile existente în loc să
// dubleze — safe de rerun. NU atinge alte platforme (bundle-urile sunt per-platformă).

const EXAMPLE_BUNDLES = [
  {
    key: 'start',
    label: 'Pachet Start',
    addonKeys: ['accounting', 'id_scanner'],
    discountPercent: 15,
    puncteLucru: 1,
    operatoriDesktop: 1,
    operatoriMobil: 0,
    documente: 100,
    onboardingHours: 3,
  },
  {
    key: 'teren',
    label: 'Pachet Teren',
    addonKeys: ['pickup', 'market_prices', 'signature_pad'],
    discountPercent: 15,
    puncteLucru: 1,
    operatoriDesktop: 1,
    operatoriMobil: 1,
    documente: 150,
    onboardingHours: 4,
  },
  {
    key: 'business',
    label: 'Pachet Business',
    addonKeys: ['crm', 'analytics', 'partner_portal', 'nexus'],
    discountPercent: 15,
    puncteLucru: 3,
    operatoriDesktop: 2,
    operatoriMobil: 1,
    documente: 300,
    onboardingHours: 6,
  },
  {
    key: 'hr_ai',
    label: 'Pachet HR & AI',
    addonKeys: ['hr', 'ai_assistant'],
    discountPercent: 15,
    puncteLucru: 3,
    operatoriDesktop: 2,
    operatoriMobil: 1,
    documente: 200,
    onboardingHours: 5,
  },
  {
    key: 'enterprise',
    label: 'Pachet Enterprise',
    addonKeys: [
      'treatment',
      'pickup',
      'market_prices',
      'nexus',
      'crm',
      'accounting',
      'signature_pad',
      'id_scanner',
      'analytics',
      'partner_portal',
      'hr',
      'ai_assistant',
    ],
    discountPercent: 15,
    puncteLucru: 8,
    operatoriDesktop: 3,
    operatoriMobil: 2,
    documente: 1000,
    onboardingHours: 9,
  },
]

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  const [platform] = await db.select().from(platforms).where(eq(platforms.type, 'vanagreen'))
  if (!platform) throw new Error('Nicio platformă type=vanagreen găsită')

  const [row] = await db.select().from(pricingConfigs).where(eq(pricingConfigs.platformId, platform.id))
  if (!row) throw new Error(`pricing_configs lipsă pt. platformId=${platform.id}`)

  const config = row.config as Record<string, unknown>
  const existingBundles = Array.isArray(config.bundles) ? (config.bundles as Array<{ key: string }>) : []
  const existingByKey = new Map(existingBundles.map((b) => [b.key, b]))

  for (const bundle of EXAMPLE_BUNDLES) existingByKey.set(bundle.key, bundle)
  const nextBundles = [...existingByKey.values()]

  const parsed = PricingConfigSchema.safeParse({ ...config, bundles: nextBundles })
  if (!parsed.success) {
    console.error('[seed-example-bundles] config rezultat NU trece validarea Zod:', parsed.error.format())
    process.exitCode = 1
    return
  }

  console.log(
    `[seed-example-bundles] platformId=${platform.id} — ${dryRun ? 'AR SCRIE' : 'scriu'} ${EXAMPLE_BUNDLES.length} bundle-uri (total după: ${nextBundles.length})`,
  )
  for (const b of EXAMPLE_BUNDLES) console.log(`  - ${b.key}: "${b.label}" — module −${b.discountPercent}%, inițiere ${b.onboardingHours} h`)

  if (!dryRun) {
    await db
      .update(pricingConfigs)
      .set({ config: { ...config, bundles: nextBundles }, updatedAt: new Date() })
      .where(eq(pricingConfigs.platformId, platform.id))
  }

  console.log('[seed-example-bundles] gata.')
}

main()
  .catch((err) => {
    console.error('[seed-example-bundles] eșuat:', err)
    process.exitCode = 1
  })
  .finally(() => sql.end())
