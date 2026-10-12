import cron from 'node-cron'
import { expirePendingActions } from '../modules/assistant/service.js'

// La fiecare 5 minute: acțiuni "confirm" (assistant_pending_actions) care au trecut de
// expiresAt (15min de la înregistrare, vezi service.ts) trec în status='expired' — Claude
// nu mai poate fi întrebat despre ele, cardul de confirmare din UI expiră vizual.
const CRON_EXPR = '*/5 * * * *'

export function startAssistantCleanupJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runAssistantCleanupJob()
  })
  console.log(`[assistant-cleanup] Scheduled (${CRON_EXPR})`)
}

export async function runAssistantCleanupJob(): Promise<void> {
  const count = await expirePendingActions()
  if (count > 0) console.log(`[assistant-cleanup] ${count} acțiuni pending expirate`)
}
