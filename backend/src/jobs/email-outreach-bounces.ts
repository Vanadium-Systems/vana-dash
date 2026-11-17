import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { checkOutreachMailboxBounces } from '../modules/email/outreach-bounce-imap.js'
import { db } from '../shared/db/client.js'
import { outreachMailboxes, syncLog } from '../shared/db/schema/index.js'
import cron from '../shared/lib/cron.js'
import { forEachTenant } from '../shared/lib/tenant-loop.js'

const CRON_EXPR = '*/15 * * * *'

export async function runOutreachBouncesCheck(): Promise<number> {
  const [log] = await db.insert(syncLog).values({ jobKey: 'email:outreach-bounces', status: 'RUNNING' }).returning()
  let totalBounces = 0

  try {
    const mailboxes = await db
      .select()
      .from(outreachMailboxes)
      .where(
        and(
          isNull(outreachMailboxes.deletedAt),
          eq(outreachMailboxes.status, 'active'),
          isNotNull(outreachMailboxes.imapHost),
        ),
      )

    for (const mailbox of mailboxes) {
      try {
        totalBounces += await checkOutreachMailboxBounces(mailbox)
      } catch (err) {
        console.error(`[email-outreach-bounces] mailbox ${mailbox.address} failed: ${String(err)}`)
      }
    }

    if (log) {
      await db
        .update(syncLog)
        .set({ status: 'SUCCESS', recordsSync: totalBounces, finishedAt: new Date() })
        .where(eq(syncLog.id, log.id))
    }
  } catch (err) {
    console.error(`[email-outreach-bounces] failed: ${String(err)}`)
    if (log) {
      await db
        .update(syncLog)
        .set({ status: 'FAILED', errorMessage: String(err).slice(0, 500), finishedAt: new Date() })
        .where(eq(syncLog.id, log.id))
    }
  }

  return totalBounces
}

export function startEmailOutreachBouncesJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void forEachTenant(async () => {
      await runOutreachBouncesCheck()
    }).catch((err) => console.error('[email-outreach-bounces] tenant loop failed:', err))
  })
  console.log(`[email-outreach-bounces] Scheduled (${CRON_EXPR})`)
}
