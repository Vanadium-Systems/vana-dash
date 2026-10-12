import cron from 'node-cron'
import {
  beginSicapRun,
  fetchContractNoticeEligibility,
  fetchOpenContractNotices,
  fetchOpenDirectAcquisitions,
  matchesAnyRule,
  matchWatchRule,
  sicapBlockedStatus,
} from '../modules/tenders/e-licitatie-client.js'
import { getCompanyProfile, getOpsJobToggles, setOpsJobToggles } from '../modules/settings/service.js'
import { listActiveWatchRules, listEligibilityCheckedNoticeIds, upsertTenderOpportunities } from '../modules/tenders/service.js'
import type { NormalizedTenderRow } from '../modules/tenders/types.js'
import { ensureAlertRule, raiseAlert } from '../shared/lib/alerting.js'
import { type LocalizedText, tl, tr, trFor } from '../shared/lib/i18n.js'

/**
 * Pragul de eligibilitate vine din „Date firmă" → Cifră de afaceri (Setări), nu hardcodat —
 * cerință 2026-09-15. Fără o valoare validă setată, NU marcăm nimic ineligibil (fail open —
 * o presupunere greșită ar ascunde oportunități reale doar pt. că nimeni n-a completat câmpul).
 */
async function getMinTurnoverThreshold(): Promise<number | null> {
  const profile = await getCompanyProfile()
  const value = Number(profile?.annualTurnoverRon)
  return Number.isFinite(value) && value > 0 ? value : null
}

// Monitor licitații publice (e-licitatie.ro/SICAP) — 09:00 + 17:00 Europe/Bucharest (11:59
// UTC vara / +2 sau +3 după oră de vară, folosim ore locale directe — server-ul rulează cu
// TZ sistem, ca restul job-urilor cron din acest fișier de pornire). Nu e `PlatformConnector`
// (sursă externă, nu platformă Vanadium Systems — vezi PLAN.md), deci nu trece prin
// jobs/sync-runner.ts / sync_log — pattern izolat, ca jobs/bnr-daily-fetch.ts.
const CRON_EXPR = '0 6,14 * * *'

export function startTenderWatchSyncJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runTenderWatchSyncJob()
  })
  console.log(`[tender-watch-sync] Scheduled (${CRON_EXPR})`)
}

/**
 * Secțiunea 3 SICAP, per-rând — izolat: dacă fetch-ul sau parsarea eșuează pt. UN anunț, restul
 * sincronizării continuă (rândul rămâne needeterminat, nu-l ascundem din prezumție greșită).
 */
async function checkEligibility(
  row: NormalizedTenderRow,
  minTurnoverThreshold: number | null,
): Promise<{ minTurnoverRon: number | null; eligibilityNote: string | null; ineligible: boolean }> {
  try {
    const result = await fetchContractNoticeEligibility(row)
    if (!result) return { minTurnoverRon: null, eligibilityNote: null, ineligible: false }
    const ineligible = minTurnoverThreshold !== null && result.minTurnoverRon !== null && result.minTurnoverRon > minTurnoverThreshold
    return { ...result, ineligible }
  } catch (err) {
    console.error(`[tender-watch-sync] verificare eligibilitate eșuată pt. „${row.title}":`, err)
    return { minTurnoverRon: null, eligibilityNote: null, ineligible: false }
  }
}

async function fetchSourceIsolated(slug: string, label: string, fetcher: () => Promise<NormalizedTenderRow[]>): Promise<NormalizedTenderRow[]> {
  try {
    return await fetcher()
  } catch (err) {
    // Izolat per sursă (regula #7 CLAUDE.md) — dacă achizițiile directe pică, licitațiile
    // publice tot se procesează, și invers.
    console.error(`[tender-watch-sync] fetch ${label} eșuat:`, err)
    const ruleId = await ensureAlertRule(`tender_watch.${slug}_fetch_failed`, tr('alerts.rules.tendersUnavailable', { label }), 'warning')
    // email: false — cerere Stefan (2026-09-14): doar alertă în-app + push pt. licitații, fără email.
    await raiseAlert(ruleId, tl('alerts.jobs.tendersFetchFailed', { label, err: String(err) }), { severity: 'warning', url: '/tenders', email: false })
    return []
  }
}

/**
 * SICAP a răspuns cu 403/429 — oprim monitorul din Setări (același toggle ca kill-switch-ul manual),
 * ca rulările următoare să nu mai lovească un IP deja semnalat. Repornirea e manuală, după ce
 * verifici că blocajul s-a ridicat.
 */
async function pauseAfterSicapBlock(status: number): Promise<void> {
  await setOpsJobToggles({ tenderWatch: false })
  const ruleId = await ensureAlertRule('tender_watch.sicap_blocked', tr('alerts.rules.tendersBlocked'), 'critical')
  await raiseAlert(
    ruleId,
    tl('alerts.jobs.tendersBlocked', { status }),
    { severity: 'critical', url: '/settings', email: false },
  )
}

export async function runTenderWatchSyncJob(): Promise<void> {
  // Kill-switch (Setări → toggle-uri cron, 2026-09-21) — util cât timp SICAP blochează IP-ul
  // (403 cunoscut), ca să nu mai lovim degeaba sursa externă la fiecare rulare.
  if (!(await getOpsJobToggles()).tenderWatch) return

  const rules = await listActiveWatchRules()
  // Regulile de urmărire decid CE intră; cele de excludere (`exclude: true`) nu opresc
  // ingestul — doar marchează rândul ca arhivat la inserare (vezi upsertTenderOpportunities).
  const includeRules = rules.filter((r) => !r.exclude)
  const excludeRules = rules.filter((r) => r.exclude)
  if (includeRules.length === 0) {
    console.log('[tender-watch-sync] nicio regulă de urmărire activă — sar peste rulare')
    return
  }

  // Ritmul și plafonul de request-uri le impune clientul (vezi „Reguli de trafic spre SICAP" în
  // e-licitatie-client.ts) — cele două surse pornesc „în paralel" dar request-urile lor stau la
  // aceeași coadă, unul câte unul.
  beginSicapRun()
  const [directAcquisitions, contractNotices, minTurnoverThreshold] = await Promise.all([
    fetchSourceIsolated('direct_acquisition', tr('alerts.jobs.directPurchases'), fetchOpenDirectAcquisitions),
    fetchSourceIsolated('contract_notice', tr('alerts.jobs.publicTenders'), fetchOpenContractNotices),
    getMinTurnoverThreshold(),
  ])

  const rulesById = new Map(includeRules.map((r) => [r.id, r]))
  const toCheck = [...directAcquisitions, ...contractNotices]
    .map((row) => ({ row, matchedRuleId: matchWatchRule(row, includeRules) }))
    .filter((r): r is { row: NormalizedTenderRow; matchedRuleId: string } => r.matchedRuleId !== null)
  const alreadyChecked = await listEligibilityCheckedNoticeIds(
    toCheck.filter(({ row }) => row.source === 'contract_notice').map(({ row }) => row.externalId),
  )

  const matched: Array<NormalizedTenderRow & {
    matchedRuleId: string
    isPriority: boolean
    excludedByRule: boolean
    minTurnoverRon: number | null
    eligibilityNote: string | null
    ineligibleByTurnover: boolean
  }> = []
  for (const { row, matchedRuleId } of toCheck) {
    // După un 403 clientul nu mai trimite nimic; rândurile rămase intră fără verificare.
    const skipCheck = alreadyChecked.has(row.externalId) || sicapBlockedStatus() !== null
    const eligibility = skipCheck
      ? { minTurnoverRon: null, eligibilityNote: null, ineligible: false }
      : await checkEligibility(row, minTurnoverThreshold)
    matched.push({
      ...row,
      matchedRuleId,
      isPriority: rulesById.get(matchedRuleId)?.highPriority ?? false,
      excludedByRule: excludeRules.length > 0 && matchesAnyRule(row, excludeRules),
      minTurnoverRon: eligibility.minTurnoverRon,
      eligibilityNote: eligibility.eligibilityNote,
      ineligibleByTurnover: eligibility.ineligible,
    })
  }

  const blockedStatus = sicapBlockedStatus()
  if (blockedStatus !== null) await pauseAfterSicapBlock(blockedStatus)

  if (matched.length === 0) {
    console.log('[tender-watch-sync] nicio oportunitate nouă potrivită regulilor active')
    return
  }

  const { inserted, updated, rows } = await upsertTenderOpportunities(matched)
  console.log(`[tender-watch-sync] ${inserted} noi, ${updated} actualizate`)

  // Rows auto-archived by an exclusion rule raise no alert: the user already said the category
  // is of no interest, so there is nothing to tell them.
  const newRows = rows.filter((r) => r.inserted && !r.dismissedAt)
  if (newRows.length > 0) {
    const ruleId = await ensureAlertRule('tender_watch.new_opportunities', tr('alerts.rules.newTenders'), 'info')
    await raiseAlert(ruleId, tl('alerts.jobs.newTenders', { count: newRows.length }), {
      severity: 'info',
      url: '/tenders',
      email: false,
    })
  }

  // Alertă separată, mai puternică, DOAR pt. potriviri pe reguli de prioritate înaltă — cerință
  // Stefan (2026-09-14): regulile largi (CPV 72/48) produc destul zgomot încât alerta generică
  // de mai sus nu mai iese în evidență; asta e semnalul pt. ce chiar contează.
  const newPriorityRows = newRows.filter((r) => r.isPriority)
  if (newPriorityRows.length > 0) {
    const ruleId = await ensureAlertRule('tender_watch.new_priority_opportunities', tr('alerts.rules.importantTender'), 'critical')
    const titles = newPriorityRows
      .slice(0, 5)
      .map((r) => r.title)
      .join('; ')
    const extra = newPriorityRows.length - 5
    const message: LocalizedText = (locale) =>
      trFor(locale, 'alerts.jobs.importantTenders', {
        count: newPriorityRows.length,
        titles: extra > 0 ? trFor(locale, 'alerts.jobs.andMore', { titles, count: extra }) : titles,
      })
    await raiseAlert(ruleId, message, {
      severity: 'critical',
      url: '/tenders',
      email: false,
    })
  }
}
