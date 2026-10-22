import { boolean, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { tenantColumns } from './tenant-column.js'

// Chei provideri de preț pt. Assets (PLAN.md Track D — Wave 7): Finnhub (acțiuni/ETF-uri),
// Twelve Data (XAU/USD, XAG/USD + fallback). Cheile sunt criptate AES-256-GCM
// (shared/lib/crypto.ts) și nu ajung NICIODATĂ în response sau loguri — pattern identic cu
// crypto_exchanges / assistant_providers. Un singur rând per provider.
export const assetPriceProviders = pgTable(
  'asset_price_providers',
  {
    ...tenantColumns,
    ...standardColumns,
    provider: text('provider', { enum: ['finnhub', 'twelvedata'] }).notNull(),
    apiKeyEnc: text('api_key_enc').notNull(),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => [uniqueIndex('uq_asset_price_providers_provider').on(t.provider)],
)
