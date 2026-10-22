import { boolean, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { standardColumns } from './helpers.js'
import { tenantColumns } from './tenant-column.js'

// Providerii asistentului (sprint de-hardcodare 2026-08-25) — un rând per provider.
// apiKeyEnc nullable = fallback pe env (ANTHROPIC_API_KEY) când lipsește. Cheia NU părăsește
// niciodată service-ul: GET întoarce doar masked (sk-…ultimele4).
export interface AssistantProviderModel {
  id: string
  label: string
  // pt. meter-ul de context din UI (sprint 2026-08-26) — opționale, rândurile vechi rămân valide
  contextWindow?: number
  inputPricePerMtok?: number
  outputPricePerMtok?: number
}

export const assistantProviders = pgTable('assistant_providers', {
  ...tenantColumns,
  ...standardColumns,
  // 'anthropic' | 'openrouter'
  provider: text('provider').notNull(),
  apiKeyEnc: text('api_key_enc'),
  // Gol = endpoint-ul oficial al providerului.
  baseUrl: text('base_url'),
  models: jsonb('models').$type<AssistantProviderModel[]>().notNull().default([]),
  defaultModel: text('default_model'),
  enabled: boolean('enabled').notNull().default(true),
}, (t) => [uniqueIndex('uq_assistant_providers_tenant_provider').on(t.tenantId, t.provider)])
