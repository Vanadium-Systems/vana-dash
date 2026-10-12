import cron from 'node-cron'
import { fetchAndStoreLatestBnrRates } from '../shared/lib/bnr.js'
import { ensureAlertRule, raiseAlert } from '../shared/lib/alerting.js'
import { getOpsJobToggles } from '../modules/settings/service.js'
import { tl, tr } from '../shared/lib/i18n.js'

// Sprint D, Track 2: cron zilnic necondiționat pt. EUR+USD — până acum
// `fetchAndStoreLatestBnrRate` rula DOAR lazy, per-factură (jobs/vanagreen-billing.ts,
// modules/financials/service.ts), deci istoricul din graficul de curs
// (GET /api/financials/exchange-rates) avea găuri în zilele fără facturare/MRR EUR.
//
// Mutat 2026-08-01 (cerință Stefan) de la 06:00 UTC (rula ÎNAINTE ca BNR să publice, deci
// prindea mereu cursul zilei precedente, nu al zilei curente) la 11:00 UTC = 14:00 ora
// României — BNR publică oficial cursul zilei ~13:00, deci acum job-ul rulează SIGUR după
// publicare. Ordonat înaintea jobs/vanagreen-billing.ts (11:30 UTC) intenționat, ca facturile
// automate de azi să ia efectiv cursul zilei, nu unul vechi din fallback-ul lazy.
const CRON_EXPR = '0 11 * * *'

export function startBnrDailyFetchJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runBnrDailyFetchJob()
  })
  console.log(`[bnr-daily-fetch] Scheduled (${CRON_EXPR})`)
}

export async function runBnrDailyFetchJob(): Promise<void> {
  // Kill-switch (Setări → toggle-uri cron, 2026-09-21).
  if (!(await getOpsJobToggles()).bnrFeed) return

  try {
    const rows = await fetchAndStoreLatestBnrRates(['EUR', 'USD'])
    console.log(`[bnr-daily-fetch] curs actualizat: ${rows.map((r) => `${r.currency}=${r.rate}`).join(', ')}`)
  } catch (err) {
    // Izolat (regula #7 CLAUDE.md) — BNR jos nu oprește restul job-urilor. Cursul de
    // azi lipsă e acoperit oricum de fallback-ul lazy din getRateForDate la facturare.
    //
    // Alertă adăugată 2026-08-18: `console.error` singur a lăsat feed-ul BNR spart
    // (URL mutat de BNR, vezi shared/lib/bnr.ts) nedescoperit 13 zile — până a fost
    // observat indirect, ca lentoare de 3-5s pe /api/plan și /api/reports/*.
    console.error('[bnr-daily-fetch] eroare:', err)
    const ruleId = await ensureAlertRule('bnr_feed.fetch_failed', tr('alerts.rules.bnrFeed'), 'warning')
    // email: false — consecvent cu tender-watch-sync.ts și accounting-alerts.ts
    // (bank_sync_failed): blipuri de sursă externă rămân doar alertă în-app + push.
    await raiseAlert(ruleId, tl('alerts.jobs.bnrFailed', { err: String(err) }), {
      severity: 'warning',
      url: '/financials',
      email: false,
    })
  }
}
