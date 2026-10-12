import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../../shared/db/client.js'
import { assistantProviders, dashboardConfig, type AssistantProviderModel } from '../../../shared/db/schema/index.js'
import { decryptApiKey, encryptApiKey } from '../../../shared/lib/crypto.js'
import { config } from '../../../shared/config.js'
import { ASSISTANT_MODELS } from '../models.js'
import { createAnthropicProvider } from './anthropic.js'
import { createOpenRouterProvider, OPENROUTER_DEFAULT_BASE_URL } from './openrouter.js'
import { ASSISTANT_PROVIDER_IDS, type AssistantProvider, type AssistantProviderId } from './types.js'
import { ProviderUpdateSchema } from '../providers-schema.js'
import { tr } from '../../../shared/lib/i18n.js'

export { toNeutralTools } from './anthropic.js'
export { ASSISTANT_PROVIDER_IDS } from './types.js'
export type { AssistantProviderId } from './types.js'

// Seed lazy + idempotent (același pattern ca contract templates): prima citire inserează
// rândurile canonice — anthropic cu modelele din ASSISTANT_MODELS (fără cheie: fallback pe
// ANTHROPIC_API_KEY din env până Stefan pune una dedicată din UI), openrouter gol + disabled.
async function ensureSeeded(): Promise<void> {
  await db
    .insert(assistantProviders)
    .values([
      {
        provider: 'anthropic',
        models: ASSISTANT_MODELS.map((m) => ({ id: m.id, label: m.label })),
        defaultModel: config.anthropic.model,
        enabled: true,
      },
      { provider: 'openrouter', models: [], defaultModel: null, enabled: false },
    ])
    .onConflictDoNothing({ target: assistantProviders.provider })
}

type ProviderRow = typeof assistantProviders.$inferSelect

async function getRow(provider: AssistantProviderId): Promise<ProviderRow | null> {
  const [row] = await db.select().from(assistantProviders).where(eq(assistantProviders.provider, provider))
  return row ?? null
}

function maskKey(key: string): string {
  return key.length <= 8 ? '••••' : `••••${key.slice(-4)}`
}

/** Tot EXCEPT cheia — GET public pt. Setări. Cheia pleacă doar ca masked preview. */
export async function listProviderSettings(): Promise<Array<{
  provider: string
  enabled: boolean
  isDefault: boolean
  baseUrl: string | null
  effectiveBaseUrl: string | null
  apiKeyPreview: string | null
  hasEnvFallbackKey: boolean
  models: Array<{ id: string; label: string; contextWindow?: number; inputPricePerMtok?: number; outputPricePerMtok?: number }>
  defaultModel: string | null
}>> {
  await ensureSeeded()
  const rows = await db.select().from(assistantProviders)
  const defaultProvider = await getDefaultProvider()
  return ASSISTANT_PROVIDER_IDS.map((id) => {
    const row = rows.find((r) => r.provider === id)
    const envFallback =
      id === 'anthropic' ? Boolean(config.anthropic.apiKey) : id === 'openrouter' ? Boolean(config.openrouter.apiKey) : false
    let apiKeyPreview: string | null = null
    if (row?.apiKeyEnc) {
      try {
        apiKeyPreview = maskKey(decryptApiKey(row.apiKeyEnc))
      } catch {
        apiKeyPreview = null
      }
    }
    return {
      provider: id,
      enabled: row?.enabled ?? false,
      isDefault: defaultProvider === id,
      baseUrl: row?.baseUrl ?? null,
      effectiveBaseUrl:
        id === 'anthropic' ? null : row?.baseUrl || OPENROUTER_DEFAULT_BASE_URL,
      apiKeyPreview,
      hasEnvFallbackKey: envFallback,
      models: row?.models ?? [],
      defaultModel: row?.defaultModel ?? null,
    }
  })
}

async function getDefaultProvider(): Promise<AssistantProviderId> {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, DEFAULT_PROVIDER_KEY))
  const value = row ? (row.value as string) : null
  return value === 'openrouter' ? 'openrouter' : 'anthropic'
}

const DEFAULT_PROVIDER_KEY = 'assistant.default_provider'

export async function updateProvider(
  provider: AssistantProviderId,
  input: z.infer<typeof ProviderUpdateSchema>,
): Promise<void> {
  await ensureSeeded()
  const changes: Record<string, unknown> = { updatedAt: new Date() }
  if (input.apiKey) changes.apiKeyEnc = encryptApiKey(input.apiKey)
  if (input.baseUrl !== undefined) changes.baseUrl = input.baseUrl || null
  if (input.models !== undefined) changes.models = input.models
  if (input.defaultModel !== undefined) changes.defaultModel = input.defaultModel || null
  if (input.enabled !== undefined) changes.enabled = input.enabled
  if (Object.keys(changes).length > 1) {
    await db.update(assistantProviders).set(changes).where(eq(assistantProviders.provider, provider))
  }
  if (input.isDefault !== undefined && input.isDefault) {
    await db
      .insert(dashboardConfig)
      .values({ key: DEFAULT_PROVIDER_KEY, value: provider })
      .onConflictDoUpdate({ target: dashboardConfig.key, set: { value: provider, updatedAt: new Date() } })
  }
}

/** Modelele disponibile în dropdown — din DB (rândurile providerilor activi), cu fallback pe
 *  ASSISTANT_MODELS dacă seed-ul nu e încă scris sau rândul are lista goală. */
export async function listAvailableModels(): Promise<
  Array<{ id: string; label: string; provider: AssistantProviderId; contextWindow?: number; inputPricePerMtok?: number; outputPricePerMtok?: number }>
> {
  await ensureSeeded()
  const rows = await db.select().from(assistantProviders)
  const result: Array<{ id: string; label: string; provider: AssistantProviderId; contextWindow?: number; inputPricePerMtok?: number; outputPricePerMtok?: number }> = []
  for (const id of ASSISTANT_PROVIDER_IDS) {
    const row = rows.find((r) => r.provider === id)
    if (!row?.enabled) continue
    const models: AssistantProviderModel[] =
      row.models.length > 0 ? row.models : id === 'anthropic' ? ASSISTANT_MODELS.map((m) => ({ ...m })) : []
    for (const m of models)
      result.push({
        id: m.id,
        label: `${m.label}${id === 'openrouter' ? ' · OpenRouter' : ''}`,
        provider: id,
        ...(m.contextWindow ? { contextWindow: m.contextWindow } : {}),
        ...(m.inputPricePerMtok !== undefined ? { inputPricePerMtok: m.inputPricePerMtok } : {}),
        ...(m.outputPricePerMtok !== undefined ? { outputPricePerMtok: m.outputPricePerMtok } : {}),
      })
  }
  // Fallback total (ambele disabled / DB ne-seeduită): Anthropic ca azi.
  if (result.length === 0) {
    return ASSISTANT_MODELS.map((m) => ({ id: m.id, label: m.label, provider: 'anthropic' as const }))
  }
  return result
}

/** Instanța de provider activă pt. o conversație: override per conversație → default global. */
export async function buildActiveProvider(override: string | null | undefined): Promise<{ provider: AssistantProvider; id: AssistantProviderId }> {
  await ensureSeeded()
  const requested = override ?? (await getDefaultProvider())
  const id: AssistantProviderId = requested === 'openrouter' ? 'openrouter' : 'anthropic'
  const row = await getRow(id)

  if (id === 'anthropic') {
    const apiKey = row?.apiKeyEnc ? decryptApiKey(row.apiKeyEnc) : config.anthropic.apiKey
    if (!apiKey) throw new Error(tr('errors.assistant.anthropicKeyMissing'))
    return { provider: createAnthropicProvider(apiKey), id }
  }

  if (row && !row.enabled) throw new Error(tr('errors.assistant.openRouterOff'))
  const apiKey = row?.apiKeyEnc ? decryptApiKey(row.apiKeyEnc) : config.openrouter.apiKey
  if (!apiKey) throw new Error(tr('errors.assistant.openRouterKeyMissing'))
  return { provider: createOpenRouterProvider({ apiKey, baseUrl: row?.baseUrl }), id }
}

/** Modelul efectiv: setat per conversație → default-ul providerului din DB → env. */
export async function resolveModel(conversationModel: string | null | undefined, providerId: AssistantProviderId): Promise<string> {
  if (conversationModel) return conversationModel
  const row = await getRow(providerId)
  if (row?.defaultModel) return row.defaultModel
  if (providerId === 'anthropic') return config.anthropic.model
  throw new Error(tr('errors.assistant.openRouterNoDefaultModel'))
}
