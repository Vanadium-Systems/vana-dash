import cron from 'node-cron'
import * as service from '../modules/assets/service.js'

// Scrie prețurile assets în platform_metrics (metricKey `asset.<symbol>`, fără '/') pt. tot
// watchlist-ul (PLAN.md Track D, Wave 7). Alertarea, dedup-ul, snooze-ul și push-ul sunt cele
// existente (jobs/metric-alerts.ts) — zero cod nou. 15 min: tier-uri gratuite (Finnhub 60/min,
// Twelve Data 8/min) — set mic de favorite, nicio presiune pe rate-limit la acest interval.

const CRON_EXPR = '*/15 * * * *'

export async function runAssetsPriceSync(): Promise<number> {
  // Doar watchlist-ul — spre deosebire de crypto (unde top-50 CoinGecko umple golul), assets
  // n-are un "univers" listabil de completat, deci o regulă de alertă pe un simbol scos din
  // watchlist rămâne fără date noi (limitare cunoscută, simbolul trebuie readăugat la favorite).
  const watchlist = await service.getWatchlist()
  const metrics: Array<{ symbol: string; value: number; meta?: Record<string, unknown> }> = []

  for (const entry of watchlist) {
    try {
      const price = await service.getPrice(entry.category, entry.symbol)
      if (price?.priceUsd != null) {
        metrics.push({ symbol: entry.symbol, value: price.priceUsd, meta: { name: entry.name, category: entry.category } })
      }
    } catch (err) {
      console.error(`[assets-price-sync] ${entry.symbol} eșuat: ${String(err)}`)
    }
  }

  await service.recordPriceMetrics(metrics)
  await service.fillDueLimitPaperOrders()
  return metrics.length
}

export function startAssetsPriceSyncJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runAssetsPriceSync().catch((err) => console.error(`[assets-price-sync] ${String(err)}`))
  })
  console.log(`[assets-price-sync] Scheduled (${CRON_EXPR})`)
}
