import cron from '../shared/lib/cron.js'
import { forEachTenant } from '../shared/lib/tenant-loop.js'
import { purgeUnattachedAttachments } from '../modules/chat/attachments.js'

// Atașamentele încărcate în Mesaje dar niciodată trimise (composerul închis, uploadul
// eșuat după ce fișierul a ajuns în R2) ocupă loc pe contul R2 al firmei. Job zilnic:
// peste 24h, rândul și obiectul din R2 dispar.
const CRON_EXPR = '17 4 * * *'

export function startChatCleanupJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void forEachTenant(() => runChatCleanupJob()).catch((err) => console.error('[chat-cleanup] failed:', err))
  })
  console.log(`[chat-cleanup] Scheduled (${CRON_EXPR})`)
}

export async function runChatCleanupJob(): Promise<void> {
  const purged = await purgeUnattachedAttachments()
  if (purged > 0) console.log(`[chat-cleanup] ${purged} atașamente netrimise șterse`)
}
