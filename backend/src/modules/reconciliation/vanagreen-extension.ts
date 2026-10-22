import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  confirmReferralDiscount,
  createVanagreenTenant,
  extendVanagreenSubscription,
  fetchReferralDiscountStatus,
  fetchVanagreenDemoTenants,
  fetchVanagreenInactiveTenants,
  fetchVanagreenTenants,
  fetchVanagreenTerminatedTenants,
  pushVanagreenBillingCycle,
  pushVanagreenLegalDetails,
  type CreateVanagreenTenantResult,
  type VanagreenTenant,
} from '../../connectors/vanagreen/billing.js'
import type { PlatformConfig } from '../../connectors/types.js'
import { db } from '../../shared/db/client.js'
import { billingClients, dashboardConfig, platforms, vanagreenExtensionLog } from '../../shared/db/schema/index.js'
import { decryptApiKey } from '../../shared/lib/crypto.js'
import { tr } from '../../shared/lib/i18n.js'

// Sprint C, Track B: la o plată confirmată (auto-match bancar SAU mark-as-paid manual),
// dacă billing_client-ul e mapat la un tenant vanagreen, extinde abonamentul acolo.
// Toggle global OFF implicit (dashboard_config) — Stefan a cerut explicit ca ambele căi
// (automat + manual) să rămână disponibile "mai mult pentru teste, până merge automat".

const TOGGLE_KEY = 'vanagreen_auto_extend_enabled'

export async function isAutoExtendEnabled(): Promise<boolean> {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, TOGGLE_KEY))
  return row ? Boolean(row.value) : false
}

export async function setAutoExtendEnabled(enabled: boolean): Promise<void> {
  await db
    .insert(dashboardConfig)
    .values({ key: TOGGLE_KEY, value: enabled })
    .onConflictDoUpdate({ target: [dashboardConfig.tenantId, dashboardConfig.key], set: { value: sql`excluded.value`, updatedAt: new Date() } })
}

/** Null dacă platforma 'vanagreen' nu e configurată în Platforme — apelanții tratează ca no-op. */
export async function getVanagreenPlatformConfig(): Promise<PlatformConfig | null> {
  // Bug găsit la QA Sprint 2/3/4 (2026-07-24): fără filtrul deletedAt, un platform 'vanagreen'
  // șters (soft-delete) tot era folosit pt. sync/push — apărea funcțional dar decripta un
  // apiKeyEnc dintr-un rând care n-ar mai trebui să existe logic.
  const [platform] = await db
    .select()
    .from(platforms)
    .where(and(eq(platforms.type, 'vanagreen'), isNull(platforms.deletedAt)))
  if (!platform) return null
  return {
    id: platform.id,
    name: platform.name,
    type: platform.type,
    apiUrl: platform.apiUrl,
    apiKey: decryptApiKey(platform.apiKeyEnc),
  }
}

/** Pt. UI-ul de mapare billing_client ↔ tenant (sugestie fuzzy + confirmare). */
export async function listVanagreenTenantsForMapping(): Promise<VanagreenTenant[]> {
  const config = await getVanagreenPlatformConfig()
  if (!config) return []
  return fetchVanagreenTenants(config)
}

/**
 * Verificare sincronă la salvarea unei mapări manuale (id introdus liber).
 *
 * Bug (2026-09-21, Stefan): verifica DOAR `fetchVanagreenTenants` (tenanții activi, non-demo) —
 * un tenant existent dar demo/inactiv/reziliat (`jobs/vanagreen-tenant-sync.ts` îi tratează pe
 * toți 3 separat, la fel ca aici) raporta fals "nu există". Verificăm acum toate cele 4 liste,
 * izolat (un endpoint picat nu blochează verificarea pe celelalte).
 */
export async function verifyVanagreenTenant(tenantId: string): Promise<boolean> {
  const config = await getVanagreenPlatformConfig()
  if (!config) return false
  const results = await Promise.allSettled([
    fetchVanagreenTenants(config),
    fetchVanagreenDemoTenants(config),
    fetchVanagreenInactiveTenants(config),
    fetchVanagreenTerminatedTenants(config),
  ])
  return results.some((r) => r.status === 'fulfilled' && r.value.some((t) => t.id === tenantId))
}

export interface MaybeExtendInput {
  billingClientId: string | null
  /** 'auto_match' (bank-sync.ts) sau 'mark_paid' (mark-as-paid manual). */
  source: 'auto_match' | 'mark_paid'
  /** Stabil per acțiune — id-ul payment_match-ului sau al facturii marcate manual. */
  sourceId: string
}

function addMonths(fromIso: string | null, months: number): string {
  const base = fromIso ? new Date(`${fromIso}T00:00:00.000Z`) : new Date()
  const next = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, base.getUTCDate()))
  return next.toISOString().slice(0, 10)
}

/**
 * No-op silențios dacă billing_client-ul nu e mapat la vanagreen sau nu are
 * `vanagreenExtendMonths` setat — nu aruncă, nu blochează fluxul apelant (auto-match
 * bancar sau mark-as-paid nu trebuie să pice din cauza unui client nemapat).
 *
 * Sprint C, Track D: `billingDueDate`-ul NU mai vine de la vanagreen — de când vana-dash deține
 * cadența local (jobs/billing-cycle-rollover.ts), "extinde abonamentul" e un bump local pe
 * `billing_clients`. Tot mai facem UN apel către vanagreen după bump (fire-and-forget, izolat)
 * — nu pt. dată, ci pt. efectul secundar `is_demo → false` din `extendSubscriptionForTenant`
 * (recyclers_app), care rămâne "by design" dependent de acest apel. `vanagreen_extension_log`
 * rămâne tabela de idempotency (același pattern), statusul reflectă bump-ul local, nu apelul.
 *
 * Idempotent pe (source, sourceId) sub concurență reală, nu doar la retry secvențial
 * (BUG-QA-VGX-1, fixat): claimăm rândul din `vanagreen_extension_log` printr-un singur
 * INSERT ... ON CONFLICT DO NOTHING pe (source, sourceId) — un SELECT-then-INSERT separat
 * ar lăsa o fereastră de race unde 2 apeluri concurente trec amândouă de verificare
 * înainte ca vreun insert să fi comis (dublă extindere reală + `unique_violation`
 * neprins aruncat din funcție). Insert-ul ATOMIC e singurul care decide câștigătorul;
 * pierzătorii se opresc imediat, fără eroare.
 */
export async function maybeExtendSubscription(input: MaybeExtendInput): Promise<void> {
  if (!input.billingClientId) return

  const [client] = await db
    .select()
    .from(billingClients)
    .where(eq(billingClients.id, input.billingClientId))
  if (!client?.vanagreenTenantId || !client.vanagreenExtendMonths) return

  const enabled = await isAutoExtendEnabled()

  if (!enabled) {
    // Dry-run n-are efect real de duplicat — un simplu ON CONFLICT DO NOTHING e suficient,
    // nu are nevoie de update ulterior.
    await db
      .insert(vanagreenExtensionLog)
      .values({
        billingClientId: client.id,
        mode: 'dry_run',
        source: input.source,
        sourceId: input.sourceId,
        months: client.vanagreenExtendMonths,
        status: 'success',
        responseMessage: tr('errors.reconciliation.dryRun'),
      })
      .onConflictDoNothing({ target: [vanagreenExtensionLog.source, vanagreenExtensionLog.sourceId] })
    return
  }

  // Claimăm slotul ÎNAINTE de orice mutație reală. Dacă insert-ul nu întoarce rând (conflict),
  // alt apel concurent a câștigat deja cursa: no-op curat, fără eroare.
  const [claimed] = await db
    .insert(vanagreenExtensionLog)
    .values({
      billingClientId: client.id,
      mode: 'live',
      source: input.source,
      sourceId: input.sourceId,
      months: client.vanagreenExtendMonths,
      status: 'success',
      responseMessage: null,
    })
    .onConflictDoNothing({ target: [vanagreenExtensionLog.source, vanagreenExtensionLog.sourceId] })
    .returning({ id: vanagreenExtensionLog.id })
  if (!claimed) return

  const nextDueDate = addMonths(client.billingDueDate, client.vanagreenExtendMonths)

  await db
    .update(billingClients)
    .set({
      billingDueDate: nextDueDate,
      billingReminder7dSentAt: null,
      billingReminder1dSentAt: null,
      billingOverdueSentAt: null,
      updatedAt: new Date(),
    })
    .where(eq(billingClients.id, client.id))

  await db
    .update(vanagreenExtensionLog)
    .set({ status: 'success', responseMessage: `billingDueDate → ${nextDueDate}` })
    .where(eq(vanagreenExtensionLog.id, claimed.id))

  // Fire-and-forget, for the side effects on the VanaGreen side only: a confirmed payment takes
  // the tenant out of demo there (its API keeps that behaviour on the assumption that this
  // call is made), and `nextDueDate`, already computed above, is mirrored to
  // `tenants.billing_due_date` so the tenant's billing banner stays right. A failure here is
  // logged and does not change the status above: the local bump has already succeeded.
  const config = await getVanagreenPlatformConfig()
  if (config) {
    const result = await extendVanagreenSubscription(
      config,
      client.vanagreenTenantId,
      client.vanagreenExtendMonths,
      input.sourceId,
      nextDueDate,
    )
    if (!result.ok) {
      console.error(`[vanagreen-extension] clear is_demo eșuat pt. tenantul ${client.vanagreenTenantId}:`, result.message)
    }

    // Bloc izolat separat de apelul de mai sus — nu blochează, nu depinde de rezultatul lui.
    await maybeGrantReferralDiscount(config, client)
  } else {
    console.error(`[vanagreen-extension] clear is_demo sărit pt. tenantul ${client.vanagreenTenantId} — platforma vanagreen nu e configurată`)
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Grant reducere referral (30% din abonamentul tenantului ADUS, o singură dată) — apelată
 * DOAR pe calea live din `maybeExtendSubscription`. Vezi PLAN §3, sprint Referral discount
 * status (2026-08-12), pt. pașii exacți.
 *
 * Nu are gate de idempotency propriu — vanagreen oprește re-eligibilitatea după un `confirm`
 * reușit, deci un retry înainte de confirm suprascrie pending cu aceeași valoare (idempotent
 * prin construcție), iar după confirm GET-ul nu mai întoarce `eligible:true` pt. aceeași
 * recomandare.
 */
export async function maybeGrantReferralDiscount(config: PlatformConfig, client: typeof billingClients.$inferSelect): Promise<void> {
  if (!client.vanagreenTenantId) return

  try {
    const statusResult = await fetchReferralDiscountStatus(config, client.vanagreenTenantId)
    if (!statusResult.ok) {
      console.error(`[vanagreen-extension] referral discount status eșuat pt. tenantul ${client.vanagreenTenantId}:`, statusResult.message)
      return
    }
    if (!statusResult.data?.eligible) return

    const { referralId, referrerTenantId } = statusResult.data
    if (!referralId || !referrerTenantId) {
      console.error(
        `[vanagreen-extension] referral discount status inconsistentă pt. tenantul ${client.vanagreenTenantId} — eligible:true fără referralId/referrerTenantId`,
      )
      return
    }

    const [referrer] = await db
      .select()
      .from(billingClients)
      .where(and(eq(billingClients.vanagreenTenantId, referrerTenantId), isNull(billingClients.deletedAt)))
    if (!referrer) {
      console.error(
        `[vanagreen-extension] referral discount: referrer (tenant ${referrerTenantId}) nemapat la niciun billing_client — Stefan trebuie să mapeze clientul manual, reîncercăm la următoarea reînnoire`,
      )
      return
    }

    const rawPrice = client.subscriptionPriceCurrency === 'eur' ? client.subscriptionPriceEur : client.subscriptionPriceLei
    if (rawPrice === null) {
      console.error(
        `[vanagreen-extension] referral discount: clientul ${client.id} nu are preț de abonament setat pt. moneda ${client.subscriptionPriceCurrency} — nu putem calcula baza`,
      )
      return
    }

    const discountAmount = round2(Number(rawPrice) * 0.3)

    await db
      .update(billingClients)
      .set({
        referralDiscountReferralId: referralId,
        referralDiscountPendingAmount: String(discountAmount),
        referralDiscountPendingCurrency: client.subscriptionPriceCurrency,
        updatedAt: new Date(),
      })
      .where(inArray(billingClients.id, [client.id, referrer.id]))

    const confirmResult = await confirmReferralDiscount(config, client.vanagreenTenantId, referralId)
    if (!confirmResult.ok) {
      // NU rollback pe pending discount deja scris — rămâne valabil local, retry la
      // următoarea reînnoire va re-confirma (idempotent pe partea vanagreen).
      console.error(
        `[vanagreen-extension] referral discount confirm eșuat pt. tenantul ${client.vanagreenTenantId} (referral ${referralId}):`,
        confirmResult.message,
      )
    }
  } catch (err) {
    console.error(`[vanagreen-extension] referral discount grant eșuat pt. tenantul ${client.vanagreenTenantId}:`, err)
  }
}

// ---------------------------------------------------------------------------
// Sprint C, Track D — legal details (sursă de adevăr vana-dash) + creare bidirecțională.
// ---------------------------------------------------------------------------

/**
 * Push fire-and-forget izolat (regula #7 CLAUDE.md — connector failure izolat) — la un edit
 * reușit al unui billing_client mapat la vanagreen, împinge starea curentă de legal details.
 * NU aruncă niciodată; eșecul se loghează, apelantul (ruta PATCH) nu blochează salvarea locală
 * pe el. Dacă platforma vanagreen nu e configurată, e tratat ca eșec izolat (log), nu excepție.
 */
export async function pushLegalDetailsIfMapped(client: typeof billingClients.$inferSelect): Promise<void> {
  if (!client.vanagreenTenantId) return

  const config = await getVanagreenPlatformConfig()
  if (!config) {
    console.error(`[vanagreen-extension] push legal details sărit pt. clientul ${client.id} — platforma vanagreen nu e configurată`)
    return
  }

  const result = await pushVanagreenLegalDetails(config, client.vanagreenTenantId, {
    companyName: client.name,
    cui: client.cif,
    registryNumber: client.regCom ?? undefined,
    address: client.address,
    city: client.city ?? undefined,
    county: client.county ?? undefined,
  })

  if (!result.ok) {
    console.error(`[vanagreen-extension] push legal details eșuat pt. clientul ${client.id} (tenant ${client.vanagreenTenantId}):`, result.message)
  }
}

/**
 * Push fire-and-forget izolat — la orice schimbare a cadenței/scadenței unui billing_client
 * mapat (edit manual din ClientFormDialog SAU rostogolire zilnică din
 * jobs/billing-cycle-rollover.ts), împinge starea curentă spre `tenants.billing_due_date`/
 * `billing_cycle*` din vanagreen — coloanele rămân acolo doar ca oglindă read-only, citită de
 * `BillingBanner.tsx` (tenant-facing) și AdminTenantsPage (read-only, wave 6). NU aruncă
 * niciodată; eșecul se loghează, apelantul nu blochează pe el.
 */
export async function pushBillingCycleIfMapped(client: typeof billingClients.$inferSelect): Promise<void> {
  if (!client.vanagreenTenantId) return

  const config = await getVanagreenPlatformConfig()
  if (!config) {
    console.error(`[vanagreen-extension] push billing cycle sărit pt. clientul ${client.id} — platforma vanagreen nu e configurată`)
    return
  }

  const result = await pushVanagreenBillingCycle(config, client.vanagreenTenantId, {
    billingDueDate: client.billingDueDate,
    billingCycle: client.billingCycle,
    billingCycleDay: client.billingCycleDay,
    billingCycleMonth: client.billingCycleMonth,
  })

  if (!result.ok) {
    console.error(`[vanagreen-extension] push billing cycle eșuat pt. clientul ${client.id} (tenant ${client.vanagreenTenantId}):`, result.message)
  }
}

/**
 * Creare tenant nou în vanagreen la cererea explicită a lui Stefan (checkbox "Creează și în
 * VanaGreen" la crearea unui billing_client) — NU e automat pt. orice client nou (mulți nu au
 * legătură cu vanagreen). NU aruncă — 409 (slug ocupat) e un rezultat de business normal,
 * apelantul (ruta POST) decide ce arată în UI.
 */
export async function createVanagreenTenantForClient(slug: string, name: string): Promise<CreateVanagreenTenantResult> {
  const config = await getVanagreenPlatformConfig()
  if (!config) {
    return { ok: false, status: 0, code: 'PLATFORM_NOT_CONFIGURED', message: tr('errors.reconciliation.vanagreenNotConfigured') }
  }
  return createVanagreenTenant(config, slug, name)
}
