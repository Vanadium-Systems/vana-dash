import cron from 'node-cron'
import { eq } from 'drizzle-orm'
import { listSentEmails } from '../connectors/resend/reconcile.js'
import { updateSendStatusFromWebhook, type DeliveryStatus } from '../modules/email/service.js'
import { config } from '../shared/config.js'
import { db } from '../shared/db/client.js'
import { emailSends, syncLog } from '../shared/db/schema/index.js'

// Reconciliere zilnică — plasă de siguranță pt. statusuri de livrare (trimiteri Resend)
// ratate de webhook (downtime, retry Resend epuizat ~32h). Pattern identic sync-anaf/sync-bank:
// log în sync_log, failure izolat per email, nu aruncă niciodată mai departe.
//
// (Reconcilierea inbound-ului — emailuri PRIMITE ratate de webhook — a fost eliminată odată cu
// ingestul Resend inbound, abandonat pe cost. Ingestul curent, prin Cloudflare Email Routing,
// n-are echivalent de "listă de emailuri primite" de reconciliat — webhook-ul Worker-ului
// livrează conținutul complet într-un singur POST, nu doar o notificare de urmărit ulterior.)

const CRON_EXPR = '30 3 * * *'

const LAST_EVENT_TO_STATUS: Record<string, DeliveryStatus> = {
  sent: 'sent',
  delivered: 'delivered',
  bounced: 'bounced',
  complained: 'complained',
  delivery_delayed: 'delayed',
  failed: 'failed',
  suppressed: 'failed',
}

export function startEmailReconcileJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void reconcileEmails().catch((err) => {
      console.error(`[email-reconcile] ${String(err)}`)
    })
  })
  console.log(`[email-reconcile] Scheduled (${CRON_EXPR})`)
}

export async function reconcileEmails(): Promise<void> {
  if (!config.resendApiKey) return // fără cheie, nimic de reconciliat (email dezactivat oricum)

  const [log] = await db.insert(syncLog).values({ jobKey: 'email:reconcile', status: 'RUNNING' }).returning()
  let updatedSent = 0

  try {
    updatedSent = await reconcileSent()
    if (log) {
      await db
        .update(syncLog)
        .set({ status: 'SUCCESS', recordsSync: updatedSent, finishedAt: new Date() })
        .where(eq(syncLog.id, log.id))
    }
  } catch (err) {
    console.error(`[email-reconcile] eșuat: ${String(err)}`)
    if (log) {
      await db.update(syncLog).set({ status: 'FAILED', errorMessage: String(err), finishedAt: new Date() }).where(eq(syncLog.id, log.id))
    }
    // Nu re-aruncăm — izolat, ca orice connector (regula #7 CLAUDE.md).
  }
}

async function reconcileSent(): Promise<number> {
  const { emails } = await listSentEmails(config.resendApiKey)
  let updated = 0
  for (const email of emails) {
    const status = LAST_EVENT_TO_STATUS[email.last_event]
    if (!status) continue // eveniment neurmărit (ex. opened/clicked) — ignorat, no bloat
    try {
      const [row] = await db.select().from(emailSends).where(eq(emailSends.resendEmailId, email.id)).limit(1)
      // Fără rând corespunzător (ex. reply de thread, care nu ține resendEmailId aici) SAU
      // deja pe statusul corect — skip. Esențial: NU rescriem un rând deja corect, ca să nu
      // suprascriem cu `null` un `errorMessage` deja populat corect de webhook (List Sent
      // Emails nu ne dă un motiv detaliat de bounce, doar `last_event`).
      if (!row || row.status === status) continue
      await updateSendStatusFromWebhook(email.id, status, null)
      updated++
    } catch (err) {
      console.error(`[email-reconcile] actualizare status trimis ${email.id} eșuată: ${String(err)}`)
    }
  }
  return updated
}
