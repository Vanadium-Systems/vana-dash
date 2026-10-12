import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'

// Credențialele OAuth2 pentru SPV/e-Factura. Un rând per CIF (în practică unul singur:
// Vanadium Systems SRL). Token-urile sunt criptate AES-256-GCM (shared/lib/crypto.ts)
// și nu ajung NICIODATĂ în vreun API response sau log.
export const anafCredentials = pgTable('anaf_credentials', {
  ...standardColumns,
  cif: text('cif').notNull().unique(),
  // Alias-ul certificatului digital folosit la consimțire (informativ, pentru re-auth).
  certAlias: text('cert_alias'),
  accessTokenEnc: text('access_token_enc'),
  refreshTokenEnc: text('refresh_token_enc'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
  // needs_reauth = refresh token expirat/revocat — Stefan trebuie să refacă manual
  // consimțirea cu certificatul (flow-ul de browser). Alert email la tranziție.
  status: text('status', { enum: ['unconfigured', 'active', 'needs_reauth'] })
    .notNull()
    .default('unconfigured'),
})
