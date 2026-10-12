import cron from 'node-cron'
import { and, eq, inArray, isNotNull, isNull, lte } from 'drizzle-orm'
import {
  fetchVanagreenDemoTenants,
  fetchVanagreenInactiveTenants,
  fetchVanagreenTenants,
  fetchVanagreenTerminatedTenants,
  pushVanagreenBillingCycle,
} from '../connectors/vanagreen/billing.js'
import { getVanagreenPlatformConfig } from '../modules/reconciliation/vanagreen-extension.js'
import { db } from '../shared/db/client.js'
import { billingClients } from '../shared/db/schema/index.js'

const PENDING_DELETION_PURGE_DAYS = 30

// Sprint C, Track D: tenants noi creați DIRECT în vanagreen (nu prin vana-dash) apar aici ca
// billing_clients "schelet" — needsBillingInfo=true, restul gol — vizibil în UI ca "client nou,
// completează datele". Match STRICT pe vanagreenTenantId (nu similaritate de nume) ca să nu se
// suprapună cu fluxul manual de mapare/sugestie deja existent din Track B (acela rămâne
// neschimbat pt. mapări retroactive ale tenants-ilor deja existenți la momentul livrării).
//
// 2026-08-03: același job sincronizează și tenanții demo (`GET /tenants/demo`, endpoint separat
// — vezi connectors/vanagreen/billing.ts) — scheletele lor primesc isDemo:true, afișate separat
// în UI ("Clienți demo", ClientsTab.tsx). Când un tenant deja mapat CA demo apare acum în lista
// NON-demo (Stefan l-a convertit — fie direct în vanagreen, fie printr-o plată confirmată în
// vana-dash care cheamă extendVanagreenSubscription și clarifică is_demo acolo), flipuim local
// isDemo→false — reconciliere zilnică, nu instant (vezi nota din VANAGREEN.md).
//
// 2026-08-11 (bug: a demo tenant showed up la „Clienți" în loc de „Clienți
// demo"): reversul (real→demo) SE ÎNTÂMPLĂ în practică — un client mapat inițial ca non-demo
// poate fi marcat demo ulterior direct în vanagreen. Flipuim și în sensul ăsta, în bucla de mai
// jos pe `demoTenants` (simetric cu flip-ul de aici).
//
// 2026-08-11 (Stefan): două stări suplimentare din vanagreen, fiecare cu endpoint separat
// (`GET /tenants/inactive`, `GET /tenants/terminated`) — la fel ca demo mai sus.
// - Inactiv (`isActive:false`, ne-șters) — tratat ca demo aici (Stefan: "inactivi pot fi tot
//   demo"), flip isDemo→true, fără coloană nouă. Simetric cu buclele de mai sus.
// - Reziliat (`deletedAt` setat acolo, fereastră de 30 zile înainte de purge-cron acolo) —
//   `billingClients.pendingDeletionAt` = `deletedAt`-ul de la vanagreen (nu momentul local al
//   observării, ca cele două fereastre de 30 zile să rămână sincrone). Afișat separat în UI
//   ("Clienți în ștergere"). Dacă tenantul reapare în oricare listă activă (Stefan l-a
//   restaurat în vanagreen) → `pendingDeletionAt` se curăță, în bucla corespunzătoare stării
//   noi. Purjarea locală (soft-delete pe billing_clients) rulează la finalul job-ului, DOAR pe
//   baza `pendingDeletionAt` deja stocat local — independentă de reușita fetch-ului de azi
//   pt. `/tenants/terminated`, ca un fetch eșuat o zi să nu întârzie o purjare deja decisă.
//
// 2026-08-05 (bug Stefan): billingDueDate se împinge spre vanagreen fire-and-forget, izolat,
// din 3 locuri (rollBillingDueDateOnPayment, billing-cycle-rollover.ts, maybeExtendSubscription)
// — dacă push-ul ăla eșuează (blip de rețea, vanagreen jos o clipă), nu există retry și nicio
// urmă persistentă (doar console.error efemer) — vanagreen rămâne cu data veche la nesfârșit,
// fără ca cineva să știe. `GET /tenants` (apelat mai jos oricum, pt. skeletons/isDemo) întoarce
// deja billingDueDate/billingCycle* mirror-uite din vanagreen — comparăm cu sursa de adevăr
// locală și re-împingem dacă a apărut drift, ca reconciliere zilnică de siguranță (vana-dash
// rămâne sursa de adevăr, nu recalculăm nimic, doar re-trimitem valorile locale curente).
const CRON_EXPR = '30 6 * * *'

export function startVanagreenTenantSyncJob(): void {
  cron.schedule(CRON_EXPR, () => {
    void runVanagreenTenantSyncJob()
  })
  console.log(`[vanagreen-tenant-sync] Scheduled (${CRON_EXPR})`)
}

/**
 * 2026-08-19 (Stefan — modificări făcute direct în vanagreen la tenanți existenți nu se
 * reflectau aici): bucla de mai jos flipuia doar isDemo/pendingDeletionAt/billing-cycle pt.
 * clienți deja mapați — `name`/`slug` erau scrise DOAR la crearea scheletului inițial, niciodată
 * resincronizate ulterior. O redenumire de tenant făcută direct în vanagreen (nu prin
 * vana-dash) rămânea invizibilă la infinit. Identitate (slug, name) = „ambele" în tabelul de
 * proprietate din VANAGREEN.md — reconciliere zilnică, la fel ca billing-cycle mai jos.
 */
async function syncIdentityDrift(
  clientId: string,
  mapped: { name: string; slug: string | null },
  tenant: { id: string; name: string; slug: string | null },
): Promise<void> {
  if (mapped.name === tenant.name && mapped.slug === tenant.slug) return
  try {
    await db.update(billingClients).set({ name: tenant.name, slug: tenant.slug, updatedAt: new Date() }).where(eq(billingClients.id, clientId))
    console.log(`[vanagreen-tenant-sync] identitate resincronizată pt. clientul ${clientId} (tenant vanagreen ${tenant.id}): "${mapped.name}" → "${tenant.name}"`)
  } catch (err) {
    console.error(`[vanagreen-tenant-sync] resincronizare identitate eșuată pt. clientul ${clientId}:`, err)
  }
}

export async function runVanagreenTenantSyncJob(): Promise<void> {
  const config = await getVanagreenPlatformConfig()
  if (!config) return // platforma nu e configurată — nimic de sincronizat, nu e o eroare

  let tenants: Awaited<ReturnType<typeof fetchVanagreenTenants>>
  try {
    tenants = await fetchVanagreenTenants(config)
  } catch (err) {
    console.error('[vanagreen-tenant-sync] fetch tenants eșuat, sar peste rularea de azi:', err)
    return
  }

  // Izolate de eșecul de mai sus — un endpoint nou picat nu trebuie să oprească sincronizarea
  // tenanților reali, care oricum a reușit deja.
  let demoTenants: Awaited<ReturnType<typeof fetchVanagreenDemoTenants>> = []
  try {
    demoTenants = await fetchVanagreenDemoTenants(config)
  } catch (err) {
    console.error('[vanagreen-tenant-sync] fetch tenanți demo eșuat, sar peste partea de demo azi:', err)
  }

  let inactiveTenants: Awaited<ReturnType<typeof fetchVanagreenInactiveTenants>> = []
  try {
    inactiveTenants = await fetchVanagreenInactiveTenants(config)
  } catch (err) {
    console.error('[vanagreen-tenant-sync] fetch tenanți inactivi eșuat, sar peste partea de inactivi azi:', err)
  }

  let terminatedTenants: Awaited<ReturnType<typeof fetchVanagreenTerminatedTenants>> = []
  try {
    terminatedTenants = await fetchVanagreenTerminatedTenants(config)
  } catch (err) {
    console.error('[vanagreen-tenant-sync] fetch tenanți reziliați eșuat, sar peste partea de reziliați azi:', err)
  }

  const allTenantIds = [
    ...tenants.map((t) => t.id),
    ...demoTenants.map((t) => t.id),
    ...inactiveTenants.map((t) => t.id),
    ...terminatedTenants.map((t) => t.id),
  ]

  if (allTenantIds.length > 0) {
    const mappedRows = await db
      .select({
        id: billingClients.id,
        vanagreenTenantId: billingClients.vanagreenTenantId,
        name: billingClients.name,
        slug: billingClients.slug,
        isDemo: billingClients.isDemo,
        pendingDeletionAt: billingClients.pendingDeletionAt,
        billingDueDate: billingClients.billingDueDate,
        billingCycle: billingClients.billingCycle,
        billingCycleDay: billingClients.billingCycleDay,
        billingCycleMonth: billingClients.billingCycleMonth,
      })
      .from(billingClients)
      .where(and(isNull(billingClients.deletedAt), inArray(billingClients.vanagreenTenantId, allTenantIds)))
    const mappedByTenantId = new Map(mappedRows.map((r) => [r.vanagreenTenantId, r]))

    for (const tenant of tenants) {
      const mapped = mappedByTenantId.get(tenant.id)

      if (!mapped) {
        try {
          await db.insert(billingClients).values({
            name: tenant.name,
            slug: tenant.slug,
            vanagreenTenantId: tenant.id,
            needsBillingInfo: true,
            // NOT NULL la nivel DB (facturare Vanadium reală) — placeholder gol până Stefan
            // completează, semnalat explicit de needsBillingInfo, nu silențios.
            cif: '',
            address: '',
          })
          console.log(`[vanagreen-tenant-sync] client nou (schelet) creat pt. tenant vanagreen ${tenant.id} (${tenant.name})`)
        } catch (err) {
          console.error(`[vanagreen-tenant-sync] creare schelet eșuată pt. tenant ${tenant.id}:`, err)
        }
        continue
      }

      await syncIdentityDrift(mapped.id, mapped, tenant)

      if (mapped.isDemo || mapped.pendingDeletionAt !== null) {
        try {
          await db
            .update(billingClients)
            .set({ isDemo: false, pendingDeletionAt: null, updatedAt: new Date() })
            .where(eq(billingClients.id, mapped.id))
          console.log(`[vanagreen-tenant-sync] client ${mapped.id} redevine activ (tenant vanagreen ${tenant.id} în lista reală)`)
        } catch (err) {
          console.error(`[vanagreen-tenant-sync] flip la activ eșuat pt. clientul ${mapped.id}:`, err)
        }
      }

      // Reconciliere drift (vezi comentariul de sus, 2026-08-05) — local (sursa de adevăr) e
      // singurul care câștigă, niciodată invers. `mapped.billingDueDate === null` = client fără
      // cadență setată încă local, nimic de împins.
      if (
        mapped.billingDueDate !== null &&
        (mapped.billingDueDate !== tenant.billingDueDate ||
          mapped.billingCycle !== tenant.billingCycle ||
          mapped.billingCycleDay !== tenant.billingCycleDay ||
          mapped.billingCycleMonth !== tenant.billingCycleMonth)
      ) {
        const result = await pushVanagreenBillingCycle(config, tenant.id, {
          billingDueDate: mapped.billingDueDate,
          billingCycle: mapped.billingCycle,
          billingCycleDay: mapped.billingCycleDay,
          billingCycleMonth: mapped.billingCycleMonth,
        })
        if (result.ok) {
          console.log(
            `[vanagreen-tenant-sync] drift billing-cycle corectat pt. clientul ${mapped.id} (tenant ${tenant.id}): ${tenant.billingDueDate} → ${mapped.billingDueDate}`,
          )
        } else {
          console.error(`[vanagreen-tenant-sync] re-push billing-cycle eșuat pt. clientul ${mapped.id} (tenant ${tenant.id}):`, result.message)
        }
      }
    }

    for (const tenant of demoTenants) {
      const mapped = mappedByTenantId.get(tenant.id)

      if (!mapped) {
        try {
          await db.insert(billingClients).values({
            name: tenant.name,
            slug: tenant.slug,
            vanagreenTenantId: tenant.id,
            needsBillingInfo: true,
            isDemo: true,
            demoEndsAt: tenant.demoEndsAt,
            cif: '',
            address: '',
          })
          console.log(`[vanagreen-tenant-sync] client demo (schelet) creat pt. tenant vanagreen ${tenant.id} (${tenant.name})`)
        } catch (err) {
          console.error(`[vanagreen-tenant-sync] creare schelet demo eșuată pt. tenant ${tenant.id}:`, err)
        }
        continue
      }

      await syncIdentityDrift(mapped.id, mapped, tenant)

      if (!mapped.isDemo || mapped.pendingDeletionAt !== null) {
        try {
          await db
            .update(billingClients)
            .set({ isDemo: true, demoEndsAt: tenant.demoEndsAt, pendingDeletionAt: null, updatedAt: new Date() })
            .where(eq(billingClients.id, mapped.id))
          console.log(`[vanagreen-tenant-sync] client ${mapped.id} a devenit demo (conversie detectată pt. tenant vanagreen ${tenant.id})`)
        } catch (err) {
          console.error(`[vanagreen-tenant-sync] flip isDemo→true eșuat pt. clientul ${mapped.id}:`, err)
        }
      }
    }

    for (const tenant of inactiveTenants) {
      const mapped = mappedByTenantId.get(tenant.id)

      if (!mapped) {
        try {
          await db.insert(billingClients).values({
            name: tenant.name,
            slug: tenant.slug,
            vanagreenTenantId: tenant.id,
            needsBillingInfo: true,
            isDemo: true,
            cif: '',
            address: '',
          })
          console.log(`[vanagreen-tenant-sync] client inactiv (schelet, tratat ca demo) creat pt. tenant vanagreen ${tenant.id} (${tenant.name})`)
        } catch (err) {
          console.error(`[vanagreen-tenant-sync] creare schelet inactiv eșuată pt. tenant ${tenant.id}:`, err)
        }
        continue
      }

      await syncIdentityDrift(mapped.id, mapped, tenant)

      if (!mapped.isDemo || mapped.pendingDeletionAt !== null) {
        try {
          await db
            .update(billingClients)
            .set({ isDemo: true, pendingDeletionAt: null, updatedAt: new Date() })
            .where(eq(billingClients.id, mapped.id))
          console.log(`[vanagreen-tenant-sync] client ${mapped.id} a devenit inactiv (tratat ca demo, tenant vanagreen ${tenant.id})`)
        } catch (err) {
          console.error(`[vanagreen-tenant-sync] flip la inactiv eșuat pt. clientul ${mapped.id}:`, err)
        }
      }
    }

    for (const tenant of terminatedTenants) {
      const mapped = mappedByTenantId.get(tenant.id)
      if (!mapped || mapped.pendingDeletionAt !== null) continue // nimic de facturat, sau deja marcat

      try {
        await db
          .update(billingClients)
          .set({ pendingDeletionAt: new Date(tenant.deletedAt), updatedAt: new Date() })
          .where(eq(billingClients.id, mapped.id))
        console.log(`[vanagreen-tenant-sync] client ${mapped.id} marcat „în ștergere" (tenant vanagreen ${tenant.id} reziliat la ${tenant.deletedAt})`)
      } catch (err) {
        console.error(`[vanagreen-tenant-sync] marcare „în ștergere" eșuată pt. clientul ${mapped.id}:`, err)
      }
    }
  }

  await purgePendingDeletionClients()
}

/** Soft-delete local pt. clienții „în ștergere" de peste 30 zile — în ritm cu purge-cron-ul
 *  din vanagreen (vezi comentariul din capul fișierului). Rulează necondiționat, pe baza
 *  DOAR a `pendingDeletionAt` deja stocat local — nu depinde de fetch-urile de mai sus. */
async function purgePendingDeletionClients(): Promise<void> {
  const cutoff = new Date(Date.now() - PENDING_DELETION_PURGE_DAYS * 24 * 60 * 60 * 1000)
  const toPurge = await db
    .select({ id: billingClients.id, name: billingClients.name })
    .from(billingClients)
    .where(and(isNull(billingClients.deletedAt), isNotNull(billingClients.pendingDeletionAt), lte(billingClients.pendingDeletionAt, cutoff)))

  for (const client of toPurge) {
    try {
      await db.update(billingClients).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(billingClients.id, client.id))
      console.log(`[vanagreen-tenant-sync] client ${client.id} (${client.name}) purjat local — peste ${PENDING_DELETION_PURGE_DAYS} zile de la reziliere`)
    } catch (err) {
      console.error(`[vanagreen-tenant-sync] purjare eșuată pt. clientul ${client.id}:`, err)
    }
  }
}
