import { and, eq, isNull } from 'drizzle-orm'
import { fetchVanagreenTenants } from '../connectors/vanagreen/billing.js'
import { getVanagreenPlatformConfig } from '../modules/reconciliation/vanagreen-extension.js'
import { db, sql } from '../shared/db/client.js'
import { billingClients } from '../shared/db/schema/index.js'

// One-off run (not a cron), before the billing-cycle columns are dropped on the VanaGreen side.
// It pulls legal details and the billing cycle (tax id, registry number, address, city, county,
// due date, cadence) from the real VanaGreen tenants (GET /tenants already leaves out demo and
// trial ones) into the local billing_clients: it creates the mapping where it is missing and
// fills only the empty fields where the client exists, so an earlier manual edit here is not
// overwritten. Idempotent, safe to rerun.
//
// The billing cycle has to be part of this. Without it, pushBillingCycleIfMapped (called on
// every edit) sends the empty billingDueDate/billingCycle* from here to VanaGreen, which
// writes them as they come and so erases the real `billing_due_date` of tenants configured
// there before the cutover. Run the script again right after any reset or rollback, before the
// next edit or rollover wipes a real tenant's due date.
async function main() {
  const config = await getVanagreenPlatformConfig()
  if (!config) {
    console.error('[backfill] platforma vanagreen nu e configurată în Platforme — nimic de migrat')
    process.exitCode = 1
    return
  }

  const tenants = await fetchVanagreenTenants(config)
  console.log(`[backfill] ${tenants.length} tenant(i) primiți de la vanagreen`)

  let created = 0
  let updated = 0
  let skipped = 0

  for (const tenant of tenants) {
    const [existing] = await db
      .select()
      .from(billingClients)
      .where(and(eq(billingClients.vanagreenTenantId, tenant.id), isNull(billingClients.deletedAt)))

    if (!existing) {
      await db.insert(billingClients).values({
        name: tenant.name,
        slug: tenant.slug,
        vanagreenTenantId: tenant.id,
        // Legal details completate din vanagreen — billing (iban/preț/cadență) tot lipsește,
        // Stefan îl completează manual în UI (banner "clienți cu date incomplete").
        needsBillingInfo: true,
        cif: tenant.cif ?? '',
        regCom: tenant.registryNumber,
        address: tenant.address ?? '',
        city: tenant.city,
        county: tenant.county,
        billingDueDate: tenant.billingDueDate,
        billingCycle: tenant.billingCycle,
        billingCycleDay: tenant.billingCycleDay,
        billingCycleMonth: tenant.billingCycleMonth,
      })
      created++
      console.log(`[backfill] CREAT billing_client pt. tenant ${tenant.id} (${tenant.name})`)
      continue
    }

    const patch: Partial<typeof billingClients.$inferInsert> = {}
    if (!existing.cif && tenant.cif) patch.cif = tenant.cif
    if (!existing.regCom && tenant.registryNumber) patch.regCom = tenant.registryNumber
    if (!existing.address && tenant.address) patch.address = tenant.address
    if (!existing.city && tenant.city) patch.city = tenant.city
    if (!existing.county && tenant.county) patch.county = tenant.county
    if (!existing.slug && tenant.slug) patch.slug = tenant.slug
    if (!existing.billingDueDate && tenant.billingDueDate) patch.billingDueDate = tenant.billingDueDate
    if (!existing.billingCycle && tenant.billingCycle) patch.billingCycle = tenant.billingCycle
    if (existing.billingCycleDay == null && tenant.billingCycleDay != null) patch.billingCycleDay = tenant.billingCycleDay
    if (existing.billingCycleMonth == null && tenant.billingCycleMonth != null) patch.billingCycleMonth = tenant.billingCycleMonth

    if (Object.keys(patch).length === 0) {
      skipped++
      console.log(`[backfill] SĂRIT tenant ${tenant.id} (${tenant.name}) — billing_client-ul local e deja complet`)
      continue
    }

    await db.update(billingClients).set(patch).where(eq(billingClients.id, existing.id))
    updated++
    console.log(
      `[backfill] ACTUALIZAT billing_client ${existing.id} pt. tenant ${tenant.id} (${tenant.name}): ${Object.keys(patch).join(', ')}`,
    )
  }

  console.log(`[backfill] gata — creați: ${created}, actualizați: ${updated}, săriți: ${skipped}, total: ${tenants.length}`)
}

main()
  .catch((err) => {
    console.error('[backfill] eșuat:', err)
    process.exitCode = 1
  })
  .finally(() => sql.end())
