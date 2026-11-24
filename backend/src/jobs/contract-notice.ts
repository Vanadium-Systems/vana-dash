import { and, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { addMonths, syncNoticeEvent } from '../modules/contracts/registry-service.js'
import { getNoticeSettings, recordNoticeRun } from '../modules/contracts/settings-service.js'
import { db } from '../shared/db/client.js'
import { contracts } from '../shared/db/schema/index.js'
import { ensureAlertRule, raiseAlert } from '../shared/lib/alerting.js'
import { recordAudit } from '../shared/lib/audit.js'
import { getCompany } from '../shared/lib/company.js'
import cron from '../shared/lib/cron.js'
import { tl, tr, trFor } from '../shared/lib/i18n.js'
import { wallClock } from '../shared/lib/schedule-recurrence.js'
import { forEachTenant } from '../shared/lib/tenant-loop.js'

// Each company gets the check at 08:00 on its own clock, so the cron ticks hourly and every company
// runs when its local hour is 8 (a fixed UTC hour would drift by one at every daylight saving change).
const CRON_EXPR = '5 * * * *'
const RUN_HOUR_LOCAL = 8
const STALE_AFTER_MS = 26 * 60 * 60 * 1000

function localToday(now: Date, timeZone: string): string {
  const { y, m, d } = wallClock(now, timeZone)
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function minusDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/** One pass for the current company. Running it twice on the same day changes nothing the second time. */
export async function runContractNotice(today: string): Promise<{ renewed: number; expired: number; alerted: number }> {
  const { leadDays } = await getNoticeSettings()
  let renewed = 0
  let expired = 0
  let alerted = 0

  // 1. Automatic renewal: the term rolls forward until it covers today, and the notice event moves with it.
  const toRenew = await db
    .select()
    .from(contracts)
    .where(and(isNull(contracts.deletedAt), eq(contracts.status, 'signed'), eq(contracts.autoRenew, true), isNotNull(contracts.endsOn), lt(contracts.endsOn, today)))
  for (const contract of toRenew) {
    let endsOn = contract.endsOn!
    while (endsOn < today) endsOn = addMonths(endsOn, contract.renewalMonths!)
    await db.transaction(async (tx) => {
      await tx.update(contracts).set({ endsOn, noticeAlertedFor: null, updatedAt: new Date() }).where(eq(contracts.id, contract.id))
      await syncNoticeEvent(tx, contract.id)
    })
    await recordAudit({ action: 'contract.reinnoit', entityType: 'contract', entityId: contract.id, changes: { endsOn: [contract.endsOn, endsOn] } })
    renewed++
  }

  // 2. Without renewal, a signed contract past its end is over.
  const toExpire = await db
    .select({ id: contracts.id, endsOn: contracts.endsOn })
    .from(contracts)
    .where(and(isNull(contracts.deletedAt), eq(contracts.status, 'signed'), eq(contracts.autoRenew, false), isNotNull(contracts.endsOn), lt(contracts.endsOn, today)))
  for (const contract of toExpire) {
    await db.transaction(async (tx) => {
      await tx.update(contracts).set({ status: 'expired', updatedAt: new Date() }).where(eq(contracts.id, contract.id))
      await syncNoticeEvent(tx, contract.id)
    })
    await recordAudit({ action: 'contract.expirat', entityType: 'contract', entityId: contract.id, changes: { status: ['signed', 'expired'] } })
    expired++
  }

  // 3. The alert, once per term: notice_alerted_for holds the end date it was raised for.
  const due = await db
    .select()
    .from(contracts)
    .where(
      and(
        isNull(contracts.deletedAt),
        inArray(contracts.status, ['signed', 'to_sign']),
        isNotNull(contracts.noticeDays),
        isNotNull(contracts.endsOn),
        sql`${contracts.endsOn} >= ${today}::date`,
        sql`(${contracts.endsOn} - ${contracts.noticeDays}) - ${leadDays}::int <= ${today}::date`,
        sql`${contracts.noticeAlertedFor} IS DISTINCT FROM ${contracts.endsOn}`,
      ),
    )
  if (due.length > 0) {
    const ruleId = await ensureAlertRule('contracts.notice', tr('alerts.rules.contractNotice'), 'warning')
    for (const contract of due) {
      const deadline = minusDays(contract.endsOn!, contract.noticeDays!)
      await raiseAlert(
        ruleId,
        (locale) => trFor(locale, 'alerts.contracts.notice', { title: contract.title, party: contract.counterpartyName, deadline }),
        { severity: 'warning', url: `/clients/contracte/${contract.id}`, dedupeOnMessage: true },
      )
      await db.update(contracts).set({ noticeAlertedFor: contract.endsOn }).where(eq(contracts.id, contract.id))
      alerted++
    }
  }
  return { renewed, expired, alerted }
}

async function tick(now: Date): Promise<void> {
  const company = await getCompany()
  const { lastRunAt } = await getNoticeSettings()
  if (wallClock(now, company.timeZone).h === RUN_HOUR_LOCAL) {
    await runContractNotice(localToday(now, company.timeZone))
    await recordNoticeRun(now)
    return
  }
  if (lastRunAt && now.getTime() - new Date(lastRunAt).getTime() > STALE_AFTER_MS) {
    const ruleId = await ensureAlertRule('contracts.notice_stale', tr('alerts.rules.contractNoticeStale'), 'warning')
    await raiseAlert(ruleId, tl('alerts.contracts.jobStale'), { severity: 'warning' })
  }
}

export function startContractNoticeJob() {
  cron.schedule(CRON_EXPR, () => {
    void forEachTenant(() => tick(new Date())).catch((err) => console.error('[contract-notice] failed:', err))
  })
}
