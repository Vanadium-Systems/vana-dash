import cron from '../shared/lib/cron.js'
import { forEachTenant } from '../shared/lib/tenant-loop.js'
import { and, asc, eq, isNull, lt } from 'drizzle-orm'
import { db } from '../shared/db/client.js'
import { calls } from '../shared/db/schema/index.js'
import { closeCallRoom, isCallsConfigured } from '../shared/lib/call-rooms.js'
import { DailyError, getMeetings, isDailyConfigured } from '../shared/lib/daily.js'
import { getLiveKitRoomStats, isLiveKitConfigured, LiveKitError } from '../shared/lib/livekit.js'
import { ensureAlertRule, raiseAlert } from '../shared/lib/alerting.js'
import { tl, tr } from '../shared/lib/i18n.js'

// Closes rooms whose window has passed and keeps how long the call lasted. At most 20 per run,
// one at a time. A 401/429 from the provider stops the run and raises an alert, with no retry:
// the same rule as every outside service in this repo.

const CRON_EXPR = '*/30 * * * *'
export const CLOSE_BATCH = 20

export function startCallsCloseJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void forEachTenant(async () => {
      if (!(await isCallsConfigured())) return
      await runCallsClose()
    }).catch((err) => console.error('[calls-close] failed:', err))
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

  const livekitReady = await isLiveKitConfigured()
  const dailyReady = isDailyConfigured()
  let closed = 0

  for (const call of expired) {
    if (call.provider === 'livekit' && !livekitReady) continue
    if (call.provider === 'daily' && !dailyReady) continue
    try {
      const stats =
        call.provider === 'livekit'
          ? await getLiveKitRoomStats(call.roomName)
          : await getMeetings(call.roomName)
      await closeCallRoom(call, 'ended', stats)
      closed += 1
    } catch (err) {
      if (err instanceof LiveKitError && (err.status === 401 || err.status === 429)) {
        const ruleId = await ensureAlertRule('calls.livekit_refused', tr('alerts.rules.livekitRefused'))
        await raiseAlert(ruleId, tl('alerts.jobs.livekitRefused', { status: err.status }), { url: '/calls', email: false })
        break
      }
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
