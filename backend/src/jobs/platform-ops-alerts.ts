import cron from 'node-cron'
import { getPlatformOpsSignals, listPlatforms, OpsSignalsFetchError } from '../modules/platforms/service.js'
import { ensureAlertRule, raiseAlert } from '../shared/lib/alerting.js'
import { tl, tr } from '../shared/lib/i18n.js'

// Alertare pe semnalele de sănătate operațională per platformă (CPU/RAM/disk/erori/backup) —
// Stefan, 2026-07-25: doar nivelul roșu (critic) declanșează alertă, la fiecare 5 minute, ca
// să prindă probleme rapid. Reutilizează getPlatformOpsSignals (Feature 2, aceeași sursă ca
// dialogul „Sănătate" din Platforms) — zero logică nouă de fetch, doar polling + alertare.
// Platformă nefetch-abilă (rețea jos, connector picat) alertează separat ca „nu răspunde" —
// vezi VANA_DASH.md, modulul Alerts menționează explicit „platforma down".

const CRON_EXPR = '*/5 * * * *'

export function startPlatformOpsAlertsJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void checkPlatformOpsAlerts().catch((err) => console.error(`[platform-ops-alerts] ${String(err)}`))
  })
  console.log(`[platform-ops-alerts] Scheduled (${CRON_EXPR})`)
}

export async function checkPlatformOpsAlerts(): Promise<void> {
  const platformRows = await listPlatforms()

  for (const platform of platformRows) {
    try {
      const result = await getPlatformOpsSignals(platform.id)
      if (!result.found || !result.supported) continue

      for (const signal of result.data.signals) {
        if (signal.level !== 'red') continue
        const key = `platform_ops.${platform.id}.${signal.key}`
        const ruleId = await ensureAlertRule(key, `${platform.name} — ${signal.label}`)
        await raiseAlert(ruleId, `${platform.name}: ${signal.label} — ${signal.detail}`, { url: '/platforms' })
      }
    } catch (err) {
      if (err instanceof OpsSignalsFetchError) {
        const key = `platform_ops.${platform.id}.unreachable`
        const ruleId = await ensureAlertRule(key, tr('alerts.rules.platformNotResponding', { name: platform.name }))
        await raiseAlert(ruleId, tl('alerts.jobs.platformHealthFailed', { name: platform.name, message: err.message }), {
          url: '/platforms',
        })
        continue
      }
      // Failure izolat per platformă (regula #7 CLAUDE.md) — o platformă cu eroare
      // neașteptată nu oprește verificarea celorlalte.
      console.error(`[platform-ops-alerts] Platforma "${platform.name}" (${platform.id}) a eșuat: ${String(err)}`)
    }
  }
}
