// The platform admin can look at another company: every request then carries X-Tenant-Id and the
// server logs it. Kept per tab (sessionStorage), so another tab stays in the admin's own company.

const KEY = 'vana.tenantOverride'

export interface TenantOverride {
  id: string
  name: string
}

export function getTenantOverride(): TenantOverride | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as TenantOverride) : null
  } catch {
    return null
  }
}

/** Switches the tab to `tenant` (or back, with null) and reloads, so no cached data of the other company stays. */
export function setTenantOverride(tenant: TenantOverride | null): void {
  try {
    if (tenant) sessionStorage.setItem(KEY, JSON.stringify(tenant))
    else sessionStorage.removeItem(KEY)
  } catch {
    // Storage blocked: the switch simply does not happen.
  }
  window.location.assign('/')
}
