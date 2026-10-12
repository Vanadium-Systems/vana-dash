import cron from 'node-cron'
import { isNull } from 'drizzle-orm'
import { getConnector } from '../connectors/index.js'
import { db } from '../shared/db/client.js'
import { platforms } from '../shared/db/schema/index.js'
import { decryptApiKey } from '../shared/lib/crypto.js'
import { ensureAlertRule, raiseAlert } from '../shared/lib/alerting.js'
import { tl, tr } from '../shared/lib/i18n.js'

// Monitor de uptime propriu — Stefan, 2026-07-25: UptimeRobot verifică deja doar URL-ul
// (plan gratuit), aici vrem în plus backend+DB, mai des decât syncCron-ul fiecărei
// platforme (care oricum nu alertează, doar actualizează healthStatus pasiv). Două probe
// independente per platformă:
//   - "site"    — fetch simplu pe apiUrl (frontend/root răspunde)
//   - "backend" — connector.checkHealth() (backend + DB, deja implementat per platformă,
//                 ex. vanagreen GET /health face SELECT 1 cu timeout 1s și întoarce 503 dacă
//                 DB e jos — checkHealth() vede asta ca 'degraded')
// Alertă (email+push) doar dacă o probă eșuează, dedup pe regulă activă.

const CRON_EXPR = '*/5 * * * *'
const SITE_FETCH_TIMEOUT_MS = 10_000

export function startUptimeMonitorJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void checkUptime().catch((err) => console.error(`[uptime-monitor] ${String(err)}`))
  })
  console.log(`[uptime-monitor] Scheduled (${CRON_EXPR})`)
}

async function checkSite(apiUrl: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(SITE_FETCH_TIMEOUT_MS) })
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }
    return { ok: true, detail: `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, detail: String(err) }
  }
}

export async function checkUptime(): Promise<void> {
  const rows = await db
    .select({ id: platforms.id, name: platforms.name, type: platforms.type, apiUrl: platforms.apiUrl, apiKeyEnc: platforms.apiKeyEnc })
    .from(platforms)
    .where(isNull(platforms.deletedAt))

  for (const platform of rows) {
    // 'crypto'/'assets' sunt surse de date interne (rândurile există doar pt. FK-ul metricilor
    // crypto.*/asset.*), nu site-uri ale lui Stefan — "sănătatea" lor e vizibilă prin succesul
    // jobs/crypto-price-sync.ts / jobs/assets-price-sync.ts, nu printr-un ping HTTP la root.
    if (platform.type === 'crypto' || platform.type === 'assets') continue
    try {
      const site = await checkSite(platform.apiUrl)
      if (!site.ok) {
        const ruleId = await ensureAlertRule(`platform_uptime.${platform.id}.site`, tr('alerts.rules.siteDown', { name: platform.name }))
        await raiseAlert(ruleId, tl('alerts.jobs.siteDown', { name: platform.name, detail: site.detail }), { url: '/platforms' })
      }

      const connector = getConnector(platform.type)
      const health = await connector.checkHealth({
        id: platform.id,
        name: platform.name,
        type: platform.type,
        apiUrl: platform.apiUrl,
        apiKey: decryptApiKey(platform.apiKeyEnc),
      })
      if (health.status !== 'healthy') {
        const ruleId = await ensureAlertRule(`platform_uptime.${platform.id}.backend`, tr('alerts.rules.backendDegraded', { name: platform.name }))
        await raiseAlert(ruleId, `${platform.name}: backend ${health.status}${health.message ? ` (${health.message})` : ''}`, {
          url: '/platforms',
        })
      }
    } catch (err) {
      // Failure izolat per platformă (regula #7 CLAUDE.md) — o platformă cu tip de
      // connector necunoscut sau eroare neașteptată nu oprește verificarea celorlalte.
      console.error(`[uptime-monitor] Platforma "${platform.name}" (${platform.id}) a eșuat: ${String(err)}`)
    }
  }
}
