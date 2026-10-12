import cron from 'node-cron'
import { and, eq, isNull } from 'drizzle-orm'
import * as invoicingService from '../modules/invoicing/service.js'
import { db } from '../shared/db/client.js'
import { billingClients } from '../shared/db/schema/index.js'

// Zilnic: pt. fiecare billing_client mapat + autoInvoiceEnabled, dacă azi e
// billingDueDate, emite factura prin fluxul deja existent (draft→issue→send-anaf).
// NU atinge abonamentul vanagreen — extinderea rămâne strict legată de PLATĂ confirmată
// (bank-sync.ts / mark-as-paid), nu de emitere.
//
// Sprint C, Track D: billingDueDate se citește acum LOCAL din billing_clients (nu mai e
// nevoie de fetch live către vanagreen — vana-dash deține complet cadența de facturare,
// rostogolită de jobs/billing-cycle-rollover.ts).
//
// Sprint D, Track 3: linia de factură nu mai e generată dintr-un singur
// subscriptionPriceLei/Eur hardcodat — jobul caută template-ul `isDefaultForAutoInvoice`
// al clientului (linii + monedă configurate din UI, modules/invoicing templates) și
// generează factura din el (createDraftInvoice cu templateId). Dacă niciun template
// default nu e setat, jobul SARE + loghează (nu emite o factură goală/ghicită).
//
// Mutat 2026-08-01 (cerință Stefan) de la 07:00 UTC la 11:30 UTC = 14:30 ora României —
// DUPĂ jobs/bnr-daily-fetch.ts (14:00), care la rândul lui rulează după publicarea oficială
// BNR (~13:00). Altfel facturile cu linii convertite din abonament (EUR→RON) ar lua cursul
// zilei precedente din fallback-ul lazy, nu cursul real al zilei de azi.
const CRON_EXPR = '30 11 * * *'

export function startVanagreenBillingJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runVanagreenBillingJob()
  })
  console.log(`[vanagreen-billing] Scheduled (${CRON_EXPR})`)
}

export async function runVanagreenBillingJob(): Promise<void> {
  const clients = await db
    .select()
    .from(billingClients)
    .where(
      and(isNull(billingClients.deletedAt), eq(billingClients.autoInvoiceEnabled, true), eq(billingClients.isDemo, false)),
    )
  const mapped = clients.filter((c) => c.vanagreenTenantId)
  if (mapped.length === 0) return

  const todayIso = new Date().toISOString().slice(0, 10)

  for (const client of mapped) {
    try {
      if (client.billingDueDate !== todayIso) continue

      const alreadyIssued = await invoicingService.hasInvoiceForClientOnDate(client.id, todayIso)
      if (alreadyIssued) continue

      if (!client.platformId) {
        console.warn(
          `[vanagreen-billing] clientul ${client.id} are autoInvoiceEnabled dar nu e mapat la nicio platformă ` +
            `— sar peste factura de azi, nu emit una goală/ghicită`,
        )
        continue
      }

      // Re-scope 2026-07-18 — template-ul implicit e per platformă (comun tuturor clienților
      // ei), nu per client. Prețul rămâne strict pe acest client (createDraftInvoice îl rezolvă).
      const template = await invoicingService.getDefaultPlatformTemplate(client.platformId)
      if (!template) {
        console.warn(
          `[vanagreen-billing] platforma ${client.platformId} are clienți autoInvoiceEnabled dar NICIUN template ` +
            `implicit (isDefaultForAutoInvoice) — sar peste factura de azi pt. clientul ${client.id}, nu emit una goală/ghicită`,
        )
        continue
      }

      const draft = await invoicingService.createDraftInvoice({
        billingClientId: client.id,
        templateId: template.id,
      })
      const issued = await invoicingService.issueInvoice(draft.id)
      if (issued) await invoicingService.sendInvoiceToAnaf(issued.id)
      console.log(
        `[vanagreen-billing] factură emisă pt. client ${client.id} (tenant ${client.vanagreenTenantId}, template "${template.name}")`,
      )
    } catch (err) {
      console.error(`[vanagreen-billing] eroare la clientul ${client.id}:`, err)
    }
  }
}
