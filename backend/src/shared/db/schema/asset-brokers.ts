import { boolean, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { tenantColumns } from './tenant-column.js'

// Conexiunea la broker (PLAN.md Track D — Wave 7): Trading212, cheie API unică (fără secret
// separat — API-ul public T212 folosește o singură cheie în header). Criptată AES-256-GCM,
// niciodată în response/loguri. Un singur rând per broker — upsert la (re)conectare din Setări.
export const assetBrokers = pgTable(
  'asset_brokers',
  {
    ...tenantColumns,
    ...standardColumns,
    broker: text('broker', { enum: ['trading212'] }).notNull(),
    apiKeyEnc: text('api_key_enc').notNull(),
    mode: text('mode', { enum: ['paper', 'live'] }).notNull().default('paper'),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => [uniqueIndex('uq_asset_brokers_broker').on(t.broker)],
)
