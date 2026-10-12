import { and, desc, eq, isNull } from 'drizzle-orm'
import type { z } from 'zod'
import { connectors } from '../../connectors/index.js'
import type { PlatformOpsSignals } from '../../connectors/types.js'
import { db } from '../../shared/db/client.js'
import { platforms, syncLog } from '../../shared/db/schema/index.js'
import { decryptApiKey, encryptApiKey } from '../../shared/lib/crypto.js'
import type { PlatformCreateSchema, PlatformUpdateSchema } from './schema.js'

// Selecție explicită de coloane — apiKeyEnc nu părăsește niciodată service-ul.
const publicColumns = {
  id: platforms.id,
  name: platforms.name,
  type: platforms.type,
  apiUrl: platforms.apiUrl,
  syncCron: platforms.syncCron,
  healthStatus: platforms.healthStatus,
  lastSyncAt: platforms.lastSyncAt,
  metricMappings: platforms.metricMappings,
  healthPath: platforms.healthPath,
  createdAt: platforms.createdAt,
}

export async function listPlatforms() {
  return db
    .select(publicColumns)
    .from(platforms)
    .where(isNull(platforms.deletedAt))
    .orderBy(platforms.createdAt)
}

export async function getPlatform(id: string) {
  const [row] = await db
    .select(publicColumns)
    .from(platforms)
    .where(and(eq(platforms.id, id), isNull(platforms.deletedAt)))
  return row ?? null
}

export async function createPlatform(input: z.infer<typeof PlatformCreateSchema>) {
  const { apiKey, ...rest } = input
  const [row] = await db
    .insert(platforms)
    .values({ ...rest, apiKeyEnc: encryptApiKey(apiKey) })
    .returning(publicColumns)
  return row
}

export async function updatePlatform(id: string, input: z.infer<typeof PlatformUpdateSchema>) {
  const { apiKey, ...rest } = input
  const changes: Record<string, unknown> = { ...rest, updatedAt: new Date() }
  if (apiKey) changes.apiKeyEnc = encryptApiKey(apiKey)

  // Mapările aparțin conectorului generic — pe orice alt tip sunt ignorate la update,
  // indiferent ce trimite clientul (defensiv; schema respinge deja combinarea explicită).
  const [current] = await db
    .select({ type: platforms.type })
    .from(platforms)
    .where(and(eq(platforms.id, id), isNull(platforms.deletedAt)))
  if ((changes.type ?? current?.type) !== 'generic') {
    delete changes.metricMappings
    delete changes.healthPath
  }

  const [row] = await db
    .update(platforms)
    .set(changes)
    .where(and(eq(platforms.id, id), isNull(platforms.deletedAt)))
    .returning(publicColumns)
  return row ?? null
}

export async function softDeletePlatform(id: string): Promise<boolean> {
  const [row] = await db
    .update(platforms)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(platforms.id, id), isNull(platforms.deletedAt)))
    .returning({ id: platforms.id })
  return Boolean(row)
}

export class OpsSignalsFetchError extends Error {}

export type PlatformOpsSignalsResult =
  | { found: false }
  | { found: true; supported: false }
  | { found: true; supported: true; data: PlatformOpsSignals }

/**
 * Sănătate operațională per platformă (Feature 2, PLAN.md 2026-07-25) — fetch LIVE la fiecare
 * apel, fără storage/cron nou (zero bloat, evită duplicarea `monitoring/service.ts` propriu).
 * Connector fără `fetchOpsSignals` (nu toate tipurile de platformă îl implementează) →
 * `supported: false`, NU eroare. Eroare de rețea/parsing → OpsSignalsFetchError (502 în rută).
 */
export async function getPlatformOpsSignals(id: string): Promise<PlatformOpsSignalsResult> {
  const [row] = await db
    .select({
      id: platforms.id,
      name: platforms.name,
      type: platforms.type,
      apiUrl: platforms.apiUrl,
      apiKeyEnc: platforms.apiKeyEnc,
    })
    .from(platforms)
    .where(and(eq(platforms.id, id), isNull(platforms.deletedAt)))
  if (!row) return { found: false }

  const connector = connectors[row.type]
  if (!connector?.fetchOpsSignals) return { found: true, supported: false }

  try {
    const data = await connector.fetchOpsSignals({
      id: row.id,
      name: row.name,
      type: row.type,
      apiUrl: row.apiUrl,
      apiKey: decryptApiKey(row.apiKeyEnc),
    })
    return { found: true, supported: true, data }
  } catch (err) {
    throw new OpsSignalsFetchError(String(err))
  }
}

export async function listSyncLog(platformId: string, limit = 20) {
  return db
    .select({
      id: syncLog.id,
      status: syncLog.status,
      recordsSync: syncLog.recordsSync,
      errorMessage: syncLog.errorMessage,
      startedAt: syncLog.startedAt,
      finishedAt: syncLog.finishedAt,
    })
    .from(syncLog)
    .where(eq(syncLog.platformId, platformId))
    .orderBy(desc(syncLog.startedAt))
    .limit(limit)
}
