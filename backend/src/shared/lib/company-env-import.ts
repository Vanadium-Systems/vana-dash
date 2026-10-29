import { and, eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { dashboardConfig, tenants } from '../db/schema/index.js'
import { EMPTY_COMPANY_PROFILE, normalizeProfile, type CompanyProfile } from './company.js'
import { isoCodeToCountyName } from './ro-counties.js'
import { getOwnerTenantId } from './tenancy.js'

// One-off move of the owner's details from the COMPANY_* / DECLARANT_* env vars (what invoices
// and declarations were built from until 2026-10-29) into the company sheet. Runs at boot while
// the owner's sheet is still empty, so once and never again. Delete this file, and its call in
// index.ts, once no installation has the old variables left.

type Env = Record<string, string | undefined>

/** The env vars as a partial sheet: only the ones that are set. */
function profileFromEnv(env: Env): Partial<CompanyProfile> {
  const value = (key: string) => env[key]?.trim() || undefined
  const fields: Partial<CompanyProfile> = {
    name: value('COMPANY_NAME'),
    cui: value('COMPANY_CIF'),
    regCom: value('COMPANY_REG_COM'),
    iban: value('COMPANY_IBAN'),
    bank: value('COMPANY_BANK'),
    email: value('COMPANY_EMAIL'),
    phone: value('COMPANY_PHONE'),
    vatIntraCode: value('COMPANY_VAT_INTRA_CODE'),
    representative: value('COMPANY_REPRESENTATIVE'),
  }
  if (env.COMPANY_VAT_PAYER !== undefined) fields.vatPayer = env.COMPANY_VAT_PAYER === 'true'
  if (value('DECLARANT_FIRST_NAME') || value('DECLARANT_LAST_NAME')) {
    fields.declarant = {
      firstName: value('DECLARANT_FIRST_NAME') ?? '',
      lastName: value('DECLARANT_LAST_NAME') ?? '',
      role: value('DECLARANT_ROLE') ?? 'Administrator',
    }
  }
  // The address goes over as a whole: COMPANY_ADDRESS is everything after the city, so it stays
  // in `street` and the invoices keep printing the same line. The old defaults (Bucharest) apply
  // as they did.
  if (value('COMPANY_ADDRESS')) {
    fields.registeredOffice = {
      county: isoCodeToCountyName(value('COMPANY_COUNTY_CODE') ?? 'RO-B') ?? '',
      city: value('COMPANY_CITY') ?? 'Bucuresti',
      street: value('COMPANY_ADDRESS') ?? '',
      number: '',
      details: '',
      postalCode: value('COMPANY_POSTAL_CODE') ?? '',
    }
  }
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
}

/** The old sheet with the env on top, plus which fields the two disagreed on. */
export function mergeLegacyProfile(
  oldSheet: Record<string, unknown> | null,
  env: Env,
): { profile: CompanyProfile; overridden: string[] } {
  const base = oldSheet ? normalizeProfile(oldSheet) : EMPTY_COMPANY_PROFILE
  const fromEnv = profileFromEnv(env)
  const overridden = (Object.keys(fromEnv) as (keyof CompanyProfile)[]).filter(
    (key) => oldSheet && JSON.stringify(base[key]) !== JSON.stringify(EMPTY_COMPANY_PROFILE[key]) && JSON.stringify(base[key]) !== JSON.stringify(fromEnv[key]),
  )
  return { profile: normalizeProfile({ ...base, ...fromEnv }), overridden }
}

export async function importCompanyProfileFromEnv(env: Env = process.env): Promise<void> {
  const ownerId = getOwnerTenantId()
  const [owner] = await db.select({ profile: tenants.profile }).from(tenants).where(eq(tenants.id, ownerId))
  if (!owner || Object.keys(owner.profile).length > 0) return

  const [oldRow] = await db
    .select({ value: dashboardConfig.value })
    .from(dashboardConfig)
    .where(and(eq(dashboardConfig.tenantId, ownerId), eq(dashboardConfig.key, 'company.profile')))
  const oldSheet = (oldRow?.value as Record<string, unknown> | undefined) ?? null
  if (!oldSheet && !env.COMPANY_CIF && !env.COMPANY_NAME) return

  const { profile, overridden } = mergeLegacyProfile(oldSheet, env)
  await db.update(tenants).set({ profile, updatedAt: new Date() }).where(eq(tenants.id, ownerId))
  console.info('[company] company sheet imported from env' + (oldSheet ? ' and the old settings sheet' : ''))
  if (overridden.length) {
    console.warn(`[company] the env replaced these fields of the old settings sheet, check them in Settings: ${overridden.join(', ')}`)
  }
}
