import { eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { pricingConfigs } from '../../shared/db/schema/index.js'
import { PricingConfigSchema } from './schema.js'

/**
 * Parsăm config-ul din jsonb prin schema Zod — obligatoriu pt. config-uri salvate ÎNAINTE
 * de câmpurile noi (equipmentItems/addonNexusPrice/addonCrmPrice), care nu le au deloc în DB (jsonb
 * liber, fără migrare). Fără parse aici, FE primește `equipmentItems: undefined` și crapă
 * (`.length`/`.map` pe undefined) — schema are `.default()`, dar nu era aplicată niciodată
 * pe calea de citire, doar validată în teste.
 */
export async function getConfig(platformId: string) {
  const [row] = await db.select().from(pricingConfigs).where(eq(pricingConfigs.platformId, platformId))
  if (!row) return null
  return { ...row, config: PricingConfigSchema.parse(row.config) }
}

/** Upsert — un singur rând per platformă (unique pe platform_id, vezi migrarea 0012). */
export async function upsertConfig(platformId: string, config: z.infer<typeof PricingConfigSchema>) {
  const [row] = await db
    .insert(pricingConfigs)
    .values({ platformId, config })
    .onConflictDoUpdate({
      target: pricingConfigs.platformId,
      set: { config: sql`EXCLUDED.config`, updatedAt: new Date() },
    })
    .returning()
  if (!row) throw new Error('Upsert pricing config eșuat')
  return row
}
