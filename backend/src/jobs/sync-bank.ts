import cron from 'node-cron'
import { isNull } from 'drizzle-orm'
import { db } from '../shared/db/client.js'
import { bankAccounts } from '../shared/db/schema/index.js'
import { runBankSync } from '../shared/lib/bank-sync.js'
import { getOpsJobToggles } from '../modules/settings/service.js'

// Sync tranzacții bancare + matching automat post-sync.
// Failure izolat per cont: un connector picat nu oprește celelalte conturi
// (și nu oprește nici sync-ul ANAF sau al platformelor — job-uri separate).

const CRON_EXPR = '*/30 * * * *'

export function startBankSyncJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void syncAllBankAccounts()
  })
  console.log(`[sync-bank] Scheduled (${CRON_EXPR})`)
}

export async function syncAllBankAccounts(): Promise<void> {
  // Kill-switch (Setări → toggle-uri cron, 2026-09-21) — doar rularea automată respectă
  // toggle-ul; sync-ul manual (triggerBankSyncNow, buton dedicat) rămâne mereu disponibil.
  if (!(await getOpsJobToggles()).bankSync) return

  const accounts = await db.select().from(bankAccounts).where(isNull(bankAccounts.deletedAt))
  for (const account of accounts) {
    // runBankSync nu aruncă niciodată (failure izolat în sync_log)
    await runBankSync(account)
  }
}

export async function triggerBankSyncNow(accountId: string): Promise<void> {
  const accounts = await db.select().from(bankAccounts).where(isNull(bankAccounts.deletedAt))
  const account = accounts.find((a) => a.id === accountId)
  if (!account) throw new Error('Bank account not found')
  await runBankSync(account)
}
