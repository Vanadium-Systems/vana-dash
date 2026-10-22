import { boolean, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { tenantColumns } from './tenant-column.js'

// Conexiunea la exchange (PLAN.md Contract D). Cheile sunt criptate AES-256-GCM
// (shared/lib/crypto.ts) și nu ajung NICIODATĂ în response sau loguri.
// Un singur rând per exchange — upsert la (re)conectare din Setări.
export const cryptoExchanges = pgTable(
  'crypto_exchanges',
  {
    ...tenantColumns,
    ...standardColumns,
    exchange: text('exchange', { enum: ['binance', 'binance_testnet'] }).notNull(),
    apiKeyEnc: text('api_key_enc').notNull(),
    apiSecretEnc: text('api_secret_enc').notNull(),
    mode: text('mode', { enum: ['paper', 'live'] }).notNull().default('paper'),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => [uniqueIndex('uq_crypto_exchanges_exchange').on(t.exchange)],
)
