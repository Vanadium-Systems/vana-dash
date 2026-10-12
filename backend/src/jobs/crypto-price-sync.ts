import cron from 'node-cron'
import { and, eq, isNull } from 'drizzle-orm'
import { alertRules } from '../shared/db/schema/index.js'
import { db } from '../shared/db/client.js'
import * as coingecko from '../modules/crypto/coingecko.js'
import * as geckoterminal from '../modules/crypto/geckoterminal.js'
import * as service from '../modules/crypto/service.js'

// Scrie prețurile crypto în platform_metrics (metricKey `crypto.<symbol>` pt. coinurile
// CoinGecko, `crypto.dex.<pool>` pt. favoritele DEX) — acoperă watchlist-ul ÎNTEG plus top 50
// global, ca alertele de preț să meargă și pe memecoins mici (PLAN.md Contract D). Alertarea,
// dedup-ul, snooze-ul și push-ul sunt cele existente (jobs/metric-alerts.ts) — zero cod nou.

const CRON_EXPR = '*/5 * * * *'
const TOP_N = 50
const SIMPLE_PRICE_CHUNK = 80

export async function runCryptoPriceSync(): Promise<number> {
  const watchlist = await service.getWatchlist()

  const cexIds = watchlist.filter((e) => e.kind === 'cex').map((e) => e.id)
  const dexEntries = watchlist.filter((e) => e.kind === 'dex')

  // Regulile de alertă active pe `crypto.*` pentru coinuri în afara watchlist-ului/top 50 —
  // prețul lor trebuie totuși scris, altfel regula ar evalua SUM=0.
  const rules = await db
    .select({ metricKey: alertRules.metricKey })
    .from(alertRules)
    .where(and(isNull(alertRules.deletedAt), eq(alertRules.enabled, true)))
  for (const rule of rules) {
    if (!rule.metricKey.startsWith('crypto.')) continue
    const key = rule.metricKey.replace(/^crypto\./, '')
    if (!key.startsWith('dex.') && !cexIds.includes(key)) cexIds.push(key)
  }

  const metrics: Array<{ metricKey: string; value: number; meta?: Record<string, unknown> }> = []

  try {
    const { coins } = await coingecko.listMarkets(1, 'all')
    for (const coin of coins.slice(0, TOP_N)) {
      if (coin.priceUsd !== null && !cexIds.includes(coin.id)) {
        metrics.push({ metricKey: `crypto.${coin.id}`, value: coin.priceUsd, meta: { symbol: coin.symbol } })
        cexIds.push(coin.id)
      }
    }
  } catch (err) {
    console.error(`[crypto-price-sync] top markets eșuat: ${String(err)}`)
  }

  if (cexIds.length > 0) {
    try {
      // /simple/price acceptă multe ids/apel — chunk-uri sigure.
      for (let i = 0; i < cexIds.length; i += SIMPLE_PRICE_CHUNK) {
        const chunk = cexIds.slice(i, i + SIMPLE_PRICE_CHUNK)
        const prices = await coingecko.simplePrice(chunk)
        for (const [id, p] of Object.entries(prices)) {
          if (p.usd !== undefined) {
            metrics.push({
              metricKey: `crypto.${id}`,
              value: p.usd,
              meta: p.usd_24h_change !== undefined ? { change24h: p.usd_24h_change } : undefined,
            })
          }
        }
      }
    } catch (err) {
      console.error(`[crypto-price-sync] simple/price eșuat: ${String(err)}`)
    }
  }

  for (const entry of dexEntries) {
    try {
      const pool = await geckoterminal.fetchPool(entry.id)
      if (pool?.priceUsd != null) {
        metrics.push({ metricKey: `crypto.dex.${entry.id}`, value: pool.priceUsd, meta: { network: pool.network, name: entry.name } })
      }
    } catch (err) {
      console.error(`[crypto-price-sync] pool ${entry.id} eșuat: ${String(err)}`)
    }
  }

  await service.recordPriceMetrics(metrics)

  // Ordinele paper limit trecute prin preț se execută aici, la fiecare tick de preț.
  await service.fillDueLimitPaperOrders()
  return metrics.length
}

export function startCryptoPriceSyncJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runCryptoPriceSync().catch((err) => console.error(`[crypto-price-sync] ${String(err)}`))
  })
  console.log(`[crypto-price-sync] Scheduled (${CRON_EXPR})`)
}
