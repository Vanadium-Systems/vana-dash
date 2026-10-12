import { eq, sql as rawSql } from 'drizzle-orm'
import { getConnector } from '../../connectors/index.js'
import type { PlatformMetric } from '../../connectors/types.js'
import { db } from '../db/client.js'
import { platformMetrics, platforms, syncLog } from '../db/schema/index.js'
import { decryptApiKey } from './crypto.js'

type PlatformRow = typeof platforms.$inferSelect

export async function upsertMetrics(platformId: string, metrics: PlatformMetric[]): Promise<void> {
  if (metrics.length === 0) return
  await db
    .insert(platformMetrics)
    .values(
      metrics.map((m) => ({
        platformId,
        metricKey: m.metricKey,
        value: String(m.value),
        unit: m.unit,
        recordedAt: m.recordedAt,
        meta: m.meta,
      })),
    )
    .onConflictDoUpdate({
      target: [platformMetrics.platformId, platformMetrics.metricKey, platformMetrics.recordedAt],
      set: {
        value: rawSql`EXCLUDED.value`,
        meta: rawSql`EXCLUDED.meta`,
        updatedAt: new Date(),
      },
    })
}

// Rulează sync-ul unei platforme cu failure izolat: orice eroare ajunge în
// sync_log ca FAILED și NU se propagă — un connector picat nu oprește altele.
export async function runConnectorSync(platform: PlatformRow): Promise<void> {
  const [log] = await db
    .insert(syncLog)
    .values({ platformId: platform.id, status: 'RUNNING' })
    .returning()
  if (!log) throw new Error('Failed to create sync_log entry')

  try {
    const connector = getConnector(platform.type)
    const config = {
      id: platform.id,
      name: platform.name,
      type: platform.type,
      apiUrl: platform.apiUrl,
      apiKey: decryptApiKey(platform.apiKeyEnc),
      metricMappings: platform.metricMappings ?? undefined,
      healthPath: platform.healthPath,
    }
    const to = new Date()
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)

    const metrics = await connector.fetchMetrics(config, from, to)
    await upsertMetrics(platform.id, metrics)

    const health = await connector.checkHealth(config)
    await db
      .update(syncLog)
      .set({ status: 'SUCCESS', recordsSync: metrics.length, finishedAt: new Date() })
      .where(eq(syncLog.id, log.id))
    await db
      .update(platforms)
      .set({ healthStatus: health.status, lastSyncAt: new Date(), updatedAt: new Date() })
      .where(eq(platforms.id, platform.id))
  } catch (err) {
    // Mesajul de eroare poate conține detalii de la platformă, dar niciodată API key-ul
    // (decryptApiKey nu include cheia în erori, iar fetch-ul nu loghează headerele).
    await db
      .update(syncLog)
      .set({ status: 'FAILED', errorMessage: String(err), finishedAt: new Date() })
      .where(eq(syncLog.id, log.id))
    await db
      .update(platforms)
      .set({ healthStatus: 'down', updatedAt: new Date() })
      .where(eq(platforms.id, platform.id))
  }
}
