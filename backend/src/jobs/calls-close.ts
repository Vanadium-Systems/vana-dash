import cron from 'node-cron'
import { and, asc, eq, isNull, lt } from 'drizzle-orm'
import { db } from '../shared/db/client.js'
import { calls } from '../shared/db/schema/index.js'
import { closeCallRoom } from '../shared/lib/call-rooms.js'
import { DailyError, getMeetings, isDailyConfigured } from '../shared/lib/daily.js'
import { ensureAlertRule, raiseAlert } from '../shared/lib/alerting.js'
import { tl, tr } from '../shared/lib/i18n.js'

// Closes rooms whose window has passed and keeps how long the call lasted. At most 20 per run,
// one at a time. A 401/429 from Daily stops the run and raises an alert, with no retry: the same
// rule as every outside service in this repo.

const CRON_EXPR = '*/30 * * * *'
export const CLOSE_BATCH = 20

export function startCallsCloseJob(): void {
  if (!isDailyConfigured()) return
  cron.schedule(CRON_EXPR, () => {
    void runCallsClose().catch((err) => console.error(`[calls-close] ${String(err)}`))
  })
  console.log(`[calls-close] Scheduled (${CRON_EXPR})`)
}

export async function runCallsClose(now = new Date()): Promise<number> {
  const expired = await db
    .select()
    .from(calls)
    .where(and(eq(calls.status, 'open'), lt(calls.expiresAt, now), isNull(calls.deletedAt)))
    .orderBy(asc(calls.expiresAt))
    .limit(CLOSE_BATCH)

  let closed = 0
  for (const call of expired) {
    try {
      const stats = await getMeetings(call.roomName)
      await closeCallRoom(call, 'ended', stats)
      closed += 1
    } catch (err) {
      if (err instanceof DailyError && (err.status === 401 || err.status === 429)) {
        const ruleId = await ensureAlertRule('calls.daily_refused', tr('alerts.rules.dailyRefused'))
        await raiseAlert(ruleId, tl('alerts.jobs.dailyRefused', { status: err.status }), { url: '/calls', email: false })
        break
      }
      console.error(`[calls-close] ${call.id}: ${String(err)}`)
    }
  }
  return closed
}
