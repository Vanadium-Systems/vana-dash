import cron from '../shared/lib/cron.js'
import { forEachTenant } from '../shared/lib/tenant-loop.js'
import { and, asc, eq, gt, isNotNull, isNull, lt, or } from 'drizzle-orm'
import { db } from '../shared/db/client.js'
import { calls } from '../shared/db/schema/index.js'
import { closeCallRoom } from '../shared/lib/call-rooms.js'
import { getLiveKitRoomStats, isLiveKitConfigured, LiveKitError } from '../shared/lib/livekit.js'
import { ensureAlertRule, raiseAlert } from '../shared/lib/alerting.js'
import { tl, tr } from '../shared/lib/i18n.js'
import { closePushNotification } from '../shared/lib/push.js'
import { publish } from '../modules/chat/presence.js'
import { memberIds } from '../modules/chat/service.js'

// Closes rooms whose window has passed and keeps how long the call lasted. At most 20 per run,
// one at a time. A 401/429 from the provider stops the run and raises an alert, with no retry:
// the same rule as every outside service in this repo. Rows of the removed Daily provider have
// no room: they are only marked ended, first, without any request and without LiveKit configured.

const CRON_EXPR = '*/30 * * * *'
// Mesaje calls everyone left without hanging up (app killed, network gone): the client that
// leaves last ends the call itself, this catches the rest.
const EMPTY_CRON_EXPR = '*/2 * * * *'
// Longer than the ring (45 s) plus joining, so a call nobody has picked up yet is not closed.
const EMPTY_GRACE_MS = 2 * 60_000
export const CLOSE_BATCH = 20

export function startCallsCloseJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void forEachTenant(async () => {
      await runCallsClose()
    }).catch((err) => console.error('[calls-close] failed:', err))
  })
  cron.schedule(EMPTY_CRON_EXPR, () => {
    void forEachTenant(async () => {
      await runEmptyCallsClose()
    }).catch((err) => console.error('[calls-close] empty calls failed:', err))
  })
  console.log(`[calls-close] Scheduled (${CRON_EXPR}, empty Mesaje calls ${EMPTY_CRON_EXPR})`) // slop-ok: startup line every job prints
}

export async function runEmptyCallsClose(now = new Date()): Promise<number> {
  const startedBefore = new Date(now.getTime() - EMPTY_GRACE_MS)
  const open = await db
    .select()
    .from(calls)
    .where(
      and(
        eq(calls.provider, 'livekit'),
        eq(calls.status, 'open'),
        isNotNull(calls.conversationId),
        lt(calls.createdAt, startedBefore),
        or(isNull(calls.scheduledAt), lt(calls.scheduledAt, startedBefore)),
        gt(calls.expiresAt, now),
        isNull(calls.deletedAt),
      ),
    )
    .orderBy(asc(calls.createdAt))
    .limit(CLOSE_BATCH)
  if (open.length === 0 || !(await isLiveKitConfigured())) return 0

  let closed = 0
  for (const call of open) {
    try {
      const stats = await getLiveKitRoomStats(call.roomName)
      if (stats && stats.participantCount > 0) continue
      await closeCallRoom(call, 'ended', stats)
      closed += 1
      const members = await memberIds(call.conversationId!)
      publish({ type: 'call.ended', conversationId: call.conversationId!, callId: call.id }, members)
      publish({ type: 'conversation.updated', conversationId: call.conversationId! }, members)
      for (const userId of members) void closePushNotification(userId, `call-${call.id}`)
    } catch (err) {
      if (err instanceof LiveKitError && (err.status === 401 || err.status === 429)) {
        const ruleId = await ensureAlertRule('calls.livekit_refused', tr('alerts.rules.livekitRefused'))
        await raiseAlert(ruleId, tl('alerts.jobs.livekitRefused', { status: err.status }), { url: '/calls', email: false })
        break
      }
      console.error(`[calls-close] empty ${call.id}: ${String(err)}`)
    }
  }
  return closed
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
