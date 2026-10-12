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
    price: 25,
    puncteLucru: 1,
    operatoriDesktop: 1,
    operatoriMobil: 0,
    documente: 100,
    onboardingPrice: 100,
  },
  {
    key: 'teren',
    label: 'Pachet Teren',
    addonKeys: ['pickup', 'market_prices', 'signature_pad'],
    price: 50,
    puncteLucru: 1,
    operatoriDesktop: 1,
    operatoriMobil: 1,
    documente: 150,
    onboardingPrice: 130,
  },
  {
    key: 'business',
    label: 'Pachet Business',
    addonKeys: ['crm', 'analytics', 'partner_portal', 'nexus'],
    price: 50,
    puncteLucru: 3,
    operatoriDesktop: 2,
    operatoriMobil: 1,
    documente: 300,
    onboardingPrice: 220,
  },
  {
    key: 'hr_ai',
    label: 'Pachet HR & AI',
    addonKeys: ['hr', 'ai_assistant'],
    price: 30,
    puncteLucru: 3,
    operatoriDesktop: 2,
    operatoriMobil: 1,
    documente: 200,
    onboardingPrice: 200,
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
    price: 175,
    puncteLucru: 8,
    operatoriDesktop: 3,
    operatoriMobil: 2,
    documente: 1000,
    onboardingPrice: 350,
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
  for (const b of EXAMPLE_BUNDLES) console.log(`  - ${b.key}: "${b.label}" — ${b.price} EUR/lună + ${b.onboardingPrice} EUR one-time`)

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
