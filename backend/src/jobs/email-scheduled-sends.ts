import cron from 'node-cron'
import { dispatchOverdueSends } from '../modules/email/scheduled-send.js'

// Every minute: scheduled sends whose in-process timer is gone (a restart or deploy inside the
// undo window) and sends that died midway. The usual path is the timer, 5s after Send; this
// job only catches what it missed, at most ~90s late.

const CRON_EXPR = '* * * * *'

export function startEmailScheduledSendsJob(): void {
  cron.schedule(CRON_EXPR, () => {
    dispatchOverdueSends().catch((err) => {
      console.error(`[email-scheduled-sends] ${String(err)}`)
    })
  })
  console.log(`[email-scheduled-sends] Scheduled (${CRON_EXPR})`)
}
