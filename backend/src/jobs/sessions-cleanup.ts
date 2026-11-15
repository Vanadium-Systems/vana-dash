import cron from 'node-cron'
import { deleteOldSessions } from '../shared/lib/sessions.js'
import { withRlsBypass } from '../shared/lib/tenancy.js'

// Daily at 04:10 UTC (after the 03:00 backup): every refresh adds a row to user_sessions, so the
// rows revoked or expired more than 30 days ago are dropped. Crosses companies on purpose: the
// cleanup has no company of its own.
const CRON_EXPR = '10 4 * * *'

export function startSessionsCleanupJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runSessionsCleanupJob()
  })
  console.log(`[sessions-cleanup] Scheduled (${CRON_EXPR})`)
}

export async function runSessionsCleanupJob(): Promise<void> {
  try {
    const count = await withRlsBypass(() => deleteOldSessions())
    if (count > 0) console.log(`[sessions-cleanup] ${count} old session rows deleted`)
  } catch (err) {
    console.error('[sessions-cleanup] failed:', err)
  }
}
