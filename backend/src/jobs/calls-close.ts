import cron from '../shared/lib/cron.js'
import { forEachTenant } from '../shared/lib/tenant-loop.js'
import { and, asc, eq, isNull, lt } from 'drizzle-orm'
import { db } from '../shared/db/client.js'
import { calls } from '../shared/db/schema/index.js'
import { closeCallRoom } from '../shared/lib/call-rooms.js'
import { getLiveKitRoomStats, isLiveKitConfigured, LiveKitError } from '../shared/lib/livekit.js'
import { ensureAlertRule, raiseAlert } from '../shared/lib/alerting.js'
import { tl, tr } from '../shared/lib/i18n.js'

// Closes rooms whose window has passed and keeps how long the call lasted. At most 20 per run,
// one at a time. A 401/429 from the provider stops the run and raises an alert, with no retry:
// the same rule as every outside service in this repo. Rows of the removed Daily provider have
// no room: they are only marked ended, first, without any request and without LiveKit configured.

const CRON_EXPR = '*/30 * * * *'
export const CLOSE_BATCH = 20

export function startCallsCloseJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void forEachTenant(async () => {
      await runCallsClose()
    }).catch((err) => console.error('[calls-close] failed:', err))
  })
  console.log(`[calls-close] Scheduled (${CRON_EXPR})`)
}

async function endLegacyDailyCalls(now: Date): Promise<number> {
  const ended = await db
    .update(calls)
    .set({ status: 'ended', roomDeletedAt: now, updatedAt: now })
    .where(and(eq(calls.provider, 'daily'), eq(calls.status, 'open'), lt(calls.expiresAt, now), isNull(calls.deletedAt)))
    .returning({ id: calls.id })
  return ended.length
}

export async function runCallsClose(now = new Date()): Promise<number> {
  let closed = await endLegacyDailyCalls(now)

  const expired = await db
    .select()
    .from(calls)
    .where(and(eq(calls.provider, 'livekit'), eq(calls.status, 'open'), lt(calls.expiresAt, now), isNull(calls.deletedAt)))
    .orderBy(asc(calls.expiresAt))
    .limit(CLOSE_BATCH)

  const livekitReady = await isLiveKitConfigured()

  for (const call of expired) {
    if (!livekitReady) continue
    try {
      const stats = await getLiveKitRoomStats(call.roomName)
      await closeCallRoom(call, 'ended', stats)
      closed += 1
    } catch (err) {
      if (err instanceof LiveKitError && (err.status === 401 || err.status === 429)) {
        const ruleId = await ensureAlertRule('calls.livekit_refused', tr('alerts.rules.livekitRefused'))
        await raiseAlert(ruleId, tl('alerts.jobs.livekitRefused', { status: err.status }), { url: '/calls', email: false })
        break
      }
      console.error(`[calls-close] ${call.id}: ${String(err)}`)
    }
  }
  return closed
}
