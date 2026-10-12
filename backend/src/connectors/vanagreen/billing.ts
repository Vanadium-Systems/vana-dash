import type { PlatformConfig } from '../types.js'

// Sprint C, Track B: rute noi în vanagreen (recyclers_app), separate de fetchMetrics/
// checkHealth din index.ts (acelea rămân strict pt. contractul PlatformConnector/sync
// de platforme — astea sunt apeluri de billing, folosite doar din
// modules/reconciliation/vanagreen-extension.ts și jobs/vanagreen-billing.ts).

const FETCH_TIMEOUT_MS = 15_000

export interface VanagreenTenant {
  id: string
  name: string
  slug: string | null
  cif: string | null
  // Sprint C, Track D: legal details citite din vanagreen (tenant_profile acolo) — folosite
  // doar pt. migrarea inițială/verificare, NU pt. edit continuu (vana-dash e sursa de adevăr
  // după Track D, push prin pushVanagreenLegalDetails mai jos).
  registryNumber: string | null
  address: string | null
  /** Numit `locality` în vanagreen (tenant_profile.locality) — mapat aici la `city`, numele
   *  folosit în `billing_clients`. */
  city: string | null
  county: string | null
  billingDueDate: string | null
  billingCycle: 'monthly' | 'annual' | null
  billingCycleDay: number | null
  billingCycleMonth: number | null
}

interface VanagreenTenantsResponse {
  data: Array<{
    id: string
    name: string
    slug: string | null
    cif: string | null
    registry_number: string | null
    address: string | null
    locality: string | null
    county: string | null
    billing_due_date: string | null
    billing_cycle: 'monthly' | 'annual' | null
    billing_cycle_day: number | null
    billing_cycle_month: number | null
  }>
}

export async function fetchVanagreenTenants(config: PlatformConfig): Promise<VanagreenTenant[]> {
  const res = await fetch(`${config.apiUrl}/api/v1/platform/tenants`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`vanagreen tenants endpoint returned ${res.status}`)
  const payload = (await res.json()) as VanagreenTenantsResponse
  return payload.data.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    cif: t.cif,
    registryNumber: t.registry_number,
    address: t.address,
    city: t.locality,
    county: t.county,
    billingDueDate: t.billing_due_date,
    billingCycle: t.billing_cycle,
    billingCycleDay: t.billing_cycle_day,
    billingCycleMonth: t.billing_cycle_month,
  }))
}

/** Tenanți demo (`is_demo:true` acolo) — endpoint SEPARAT (`GET /tenants/demo`), deliberat, ca
 *  să nu schimbe comportamentul lui `fetchVanagreenTenants` de mai sus. Vezi tabelul „Clienți
 *  demo" din Accounting → Clienți (2026-08-03). */
export interface VanagreenDemoTenant extends VanagreenTenant {
  createdAt: string
  demoEndsAt: string | null
}

interface VanagreenDemoTenantsResponse {
  data: Array<VanagreenTenantsResponse['data'][number] & { created_at: string; demo_ends_at: string | null }>
}

export async function fetchVanagreenDemoTenants(config: PlatformConfig): Promise<VanagreenDemoTenant[]> {
  const res = await fetch(`${config.apiUrl}/api/v1/platform/tenants/demo`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`vanagreen demo tenants endpoint returned ${res.status}`)
  const payload = (await res.json()) as VanagreenDemoTenantsResponse
  return payload.data.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    cif: t.cif,
    registryNumber: t.registry_number,
    address: t.address,
    city: t.locality,
    county: t.county,
    billingDueDate: t.billing_due_date,
    billingCycle: t.billing_cycle,
    billingCycleDay: t.billing_cycle_day,
    billingCycleMonth: t.billing_cycle_month,
    createdAt: t.created_at,
    demoEndsAt: t.demo_ends_at,
  }))
}

/** Tenanți inactivi (`isActive:false`, ne-șterși) — endpoint SEPARAT (`GET /tenants/inactive`,
 *  2026-08-11), la fel ca demo mai sus. `isDemo` inclus, dar tratat uniform ca demo aici
 *  indiferent de valoare — vezi `jobs/vanagreen-tenant-sync.ts` (Stefan: un tenant pus pe
 *  pauză oricum se comportă ca un demo din perspectiva facturării: nu se trimite factură). */
export interface VanagreenInactiveTenant extends VanagreenTenant {
  isDemo: boolean
}

interface VanagreenInactiveTenantsResponse {
  data: Array<VanagreenTenantsResponse['data'][number] & { is_demo: boolean }>
}

export async function fetchVanagreenInactiveTenants(config: PlatformConfig): Promise<VanagreenInactiveTenant[]> {
  const res = await fetch(`${config.apiUrl}/api/v1/platform/tenants/inactive`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`vanagreen inactive tenants endpoint returned ${res.status}`)
  const payload = (await res.json()) as VanagreenInactiveTenantsResponse
  return payload.data.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    cif: t.cif,
    registryNumber: t.registry_number,
    address: t.address,
    city: t.locality,
    county: t.county,
    billingDueDate: t.billing_due_date,
    billingCycle: t.billing_cycle,
    billingCycleDay: t.billing_cycle_day,
    billingCycleMonth: t.billing_cycle_month,
    isDemo: t.is_demo,
  }))
}

/** Tenanți reziliați (`deletedAt` setat acolo, fereastră de 30 zile înainte de purge-cron) —
 *  endpoint SEPARAT (`GET /tenants/terminated`, 2026-08-11). `deletedAt` explicit — vana-dash
 *  își calculează fereastra locală de purjare pe TIMESTAMP-ul de-acolo, nu pe "prima dată
 *  când sync-ul a observat absența" (ar putea întârzia dacă un sync a picat o zi). */
export interface VanagreenTerminatedTenant extends VanagreenTenant {
  deletedAt: string
}

interface VanagreenTerminatedTenantsResponse {
  data: Array<VanagreenTenantsResponse['data'][number] & { deleted_at: string }>
}

export async function fetchVanagreenTerminatedTenants(config: PlatformConfig): Promise<VanagreenTerminatedTenant[]> {
  const res = await fetch(`${config.apiUrl}/api/v1/platform/tenants/terminated`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`vanagreen terminated tenants endpoint returned ${res.status}`)
  const payload = (await res.json()) as VanagreenTerminatedTenantsResponse
  return payload.data.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    cif: t.cif,
    registryNumber: t.registry_number,
    address: t.address,
    city: t.locality,
    county: t.county,
    billingDueDate: t.billing_due_date,
    billingCycle: t.billing_cycle,
    billingCycleDay: t.billing_cycle_day,
    billingCycleMonth: t.billing_cycle_month,
    deletedAt: t.deleted_at,
  }))
}

export interface LegalDetailsUpdate {
  companyName?: string
  cui?: string
  registryNumber?: string
  address?: string
  /** `city` din billing_clients — trimis ca `locality` către vanagreen. */
  city?: string
  county?: string
}

export interface LegalDetailsPushResult {
  ok: boolean
  status: number
  tenantId: string
  message?: string
}

/** NU aruncă niciodată (fire-and-forget izolat, ca extendVanagreenSubscription) — apelantul
 *  loghează eșecul și oferă buton manual de re-sincronizare, nu blochează salvarea locală. */
export async function pushVanagreenLegalDetails(
  config: PlatformConfig,
  tenantId: string,
  update: LegalDetailsUpdate,
): Promise<LegalDetailsPushResult> {
  try {
    const res = await fetch(`${config.apiUrl}/api/v1/platform/tenants/${tenantId}/legal-details`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        companyName: update.companyName,
        cui: update.cui,
        registryNumber: update.registryNumber,
        address: update.address,
        locality: update.city,
        county: update.county,
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, status: res.status, tenantId, message: text.slice(0, 500) }
    }
    return { ok: true, status: res.status, tenantId }
  } catch (err) {
    return { ok: false, status: 0, tenantId, message: String(err) }
  }
}

export interface CreateVanagreenTenantResult {
  ok: boolean
  status: number
  id?: string
  slug?: string
  name?: string
  /** 'SLUG_TAKEN' pe 409 — apelantul cere alt slug, nu retry silențios. */
  code?: string
  message?: string
}

/** NU aruncă niciodată — 409 (slug ocupat) e un rezultat de business normal, nu o eroare de
 *  rețea; apelantul (BE-ul de creare client) decide ce arată în UI. */
export async function createVanagreenTenant(
  config: PlatformConfig,
  slug: string,
  name: string,
): Promise<CreateVanagreenTenantResult> {
  try {
    const res = await fetch(`${config.apiUrl}/api/v1/platform/tenants`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, name }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    const body = (await res.json().catch(() => null)) as
      | { success: true; data: { id: string; slug: string; name: string } }
      | { success: false; error: { code: string; message: string } }
      | null
    if (!res.ok || !body?.success) {
      return {
        ok: false,
        status: res.status,
        code: body && !body.success ? body.error.code : undefined,
        message: body && !body.success ? body.error.message : undefined,
      }
    }
    return { ok: true, status: res.status, id: body.data.id, slug: body.data.slug, name: body.data.name }
  } catch (err) {
    return { ok: false, status: 0, message: String(err) }
  }
}

export interface ExtendSubscriptionResult {
  ok: boolean
  status: number
  tenantId: string
  /** Body-ul de eroare, dacă !ok — niciodată API key în mesaj. */
  message?: string
}

/** NU aruncă niciodată pe non-2xx/eroare de rețea — întoarce { ok:false, status, message }.
 *  Sprint C, Track D, wave 6: `newBillingDueDate` calculat deja de vana-dash (sursa de adevăr
 *  pt. cadență) — vanagreen doar oglindește valoarea (nu mai calculează `addMonths` local), ca
 *  să nu apară drift între cele două calcule independente. */
export async function extendVanagreenSubscription(
  config: PlatformConfig,
  tenantId: string,
  months: number,
  idempotencyKey: string,
  newBillingDueDate: string,
): Promise<ExtendSubscriptionResult> {
  try {
    const res = await fetch(`${config.apiUrl}/api/v1/platform/tenants/${tenantId}/extend-subscription`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ months, idempotencyKey, newBillingDueDate }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, status: res.status, tenantId, message: text.slice(0, 500) }
    }
    return { ok: true, status: res.status, tenantId }
  } catch (err) {
    return { ok: false, status: 0, tenantId, message: String(err) }
  }
}

export interface ReferralDiscountStatus {
  eligible: boolean
  referralId: string | null
  referrerTenantId: string | null
}

export interface ReferralDiscountStatusResult {
  ok: boolean
  status: number
  data?: ReferralDiscountStatus
  message?: string
}

interface ReferralDiscountStatusResponse {
  data: {
    eligible: boolean
    referral_id: string | null
    referrer_tenant_id: string | null
  }
}

/** NU aruncă niciodată — apelantul (maybeGrantReferralDiscount) tratează !ok ca no-op logat. */
export async function fetchReferralDiscountStatus(
  config: PlatformConfig,
  tenantId: string,
): Promise<ReferralDiscountStatusResult> {
  try {
    const res = await fetch(`${config.apiUrl}/api/v1/platform/tenants/${tenantId}/referral-discount-status`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, status: res.status, message: text.slice(0, 500) }
    }
    const payload = (await res.json()) as ReferralDiscountStatusResponse
    return {
      ok: true,
      status: res.status,
      data: {
        eligible: payload.data.eligible,
        referralId: payload.data.referral_id,
        referrerTenantId: payload.data.referrer_tenant_id,
      },
    }
  } catch (err) {
    return { ok: false, status: 0, message: String(err) }
  }
}

export interface ConfirmReferralDiscountResult {
  ok: boolean
  status: number
  alreadyApplied?: boolean
  message?: string
}

interface ConfirmReferralDiscountResponse {
  data: {
    ok: boolean
    already_applied: boolean
  }
}

/** NU aruncă niciodată — eșecul se loghează, pending discount-ul deja scris local NU se
 *  rollback-uiește (vezi maybeGrantReferralDiscount pas 7). */
export async function confirmReferralDiscount(
  config: PlatformConfig,
  tenantId: string,
  referralId: string,
): Promise<ConfirmReferralDiscountResult> {
  try {
    const res = await fetch(`${config.apiUrl}/api/v1/platform/tenants/${tenantId}/referral-discount-status/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ referral_id: referralId }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, status: res.status, message: text.slice(0, 500) }
    }
    const payload = (await res.json()) as ConfirmReferralDiscountResponse
    return { ok: payload.data.ok, status: res.status, alreadyApplied: payload.data.already_applied }
  } catch (err) {
    return { ok: false, status: 0, message: String(err) }
  }
}

export interface BillingCycleUpdate {
  billingDueDate?: string | null
  billingCycle?: 'monthly' | 'annual' | null
  billingCycleDay?: number | null
  billingCycleMonth?: number | null
}

export interface BillingCyclePushResult {
  ok: boolean
  status: number
  tenantId: string
  message?: string
}

/** NU aruncă niciodată (fire-and-forget izolat, ca pushVanagreenLegalDetails) — vanagreen
 *  păstrează `billing_due_date`/`billing_cycle*` DOAR ca oglindă read-only (BillingBanner
 *  tenant-facing + AdminTenantsPage citesc de-acolo), scrisă exclusiv de-aici. */
export async function pushVanagreenBillingCycle(
  config: PlatformConfig,
  tenantId: string,
  update: BillingCycleUpdate,
): Promise<BillingCyclePushResult> {
  try {
    const res = await fetch(`${config.apiUrl}/api/v1/platform/tenants/${tenantId}/billing-cycle`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(update),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, status: res.status, tenantId, message: text.slice(0, 500) }
    }
    return { ok: true, status: res.status, tenantId }
  } catch (err) {
    return { ok: false, status: 0, tenantId, message: String(err) }
  }
}
