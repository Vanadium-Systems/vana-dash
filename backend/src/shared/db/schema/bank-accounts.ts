import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'

// Conturile bancare sincronizate pentru reconciliere (Revolut; interfața BankConnector
// e generică — alt provider = alt folder în connectors/ + rând nou aici).
export const bankAccounts = pgTable('bank_accounts', {
  ...standardColumns,
  // Cheia din bankConnectors registry (ex: 'revolut')
  provider: text('provider').notNull(),
  name: text('name').notNull(),
  // Identificatorul contului la provider (ex: Revolut account id) — opțional,
  // dacă lipsește se sincronizează toate conturile accesibile cu token-ul.
  accountRef: text('account_ref'),
  currency: text('currency').notNull().default('RON'),
  // Token API static criptat AES-256-GCM — deprecated pentru Revolut (a trecut pe
  // OAuth2+JWT client assertion mai jos), rămâne nullable pt. provideri viitori
  // (GoCardless/SaltEdge) care pot folosi acest model de auth.
  apiKeyEnc: text('api_key_enc'),
  // --- OAuth2 + JWT client assertion (Revolut Business API) ---
  // Client ID alocat de Revolut la înregistrarea aplicației.
  clientId: text('client_id'),
  // Certificatul public (PEM) generat local, de încărcat manual de Stefan în
  // Revolut Business Settings → API. Informativ, nu e secret.
  certificatePem: text('certificate_pem'),
  // Cheia privată a certificatului, criptată AES-256-GCM. Folosită pt. semnarea
  // JWT-ului de client assertion la fiecare refresh. Nu ajunge NICIODATĂ în
  // response sau log.
  privateKeyEnc: text('private_key_enc'),
  // Access token curent, criptat AES-256-GCM. Nu ajunge NICIODATĂ în response sau log.
  accessTokenEnc: text('access_token_enc'),
  // Refresh token — la Revolut e valabil 90 zile (NU e infinit ca la ANAF), separat
  // de access token (40 min). Necesar la fiecare refresh alături de JWT client assertion.
  refreshTokenEnc: text('refresh_token_enc'),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
  lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
  // unconfigured = fără consimțire încă; active = token valid; needs_reauth =
  // refresh eșuat (analog anaf_credentials.status) — cere consimțire manuală din
  // browser. Alert email la tranziție spre needs_reauth (accounting-alerts.ts).
  authStatus: text('auth_status', { enum: ['unconfigured', 'active', 'needs_reauth'] })
    .notNull()
    .default('unconfigured'),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  healthStatus: text('health_status', { enum: ['unknown', 'healthy', 'degraded', 'down'] })
    .notNull()
    .default('unknown'),
})
