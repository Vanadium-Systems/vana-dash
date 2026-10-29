import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { getCountryPack } from '../../countries/index.js'
import { CompanyProfileIncompleteError, type SellerAddress } from '../../countries/types.js'
import { db } from '../db/client.js'
import { tenants } from '../db/schema/index.js'
import { tr } from './i18n.js'
import { currentTenantId } from './tenancy.js'

// The company sheet: the one place invoices, declarations, contracts and e-mails read the
// company's details from. It lives on the company's `tenants` row, next to its country, time
// zone and currency.

export const CompanyAddressSchema = z.object({
  county: z.string(),
  city: z.string(),
  street: z.string(),
  number: z.string(),
  // Block / staircase / floor / flat / office: too many combinations for one input each.
  details: z.string(),
  postalCode: z.string(),
})

export const CompanyLocationSchema = CompanyAddressSchema.extend({
  id: z.string(),
  label: z.string(),
})

export const CompanyProfileSchema = z.object({
  name: z.string(),
  cui: z.string(),
  vatIntraCode: z.string(),
  regCom: z.string(),
  caenCode: z.string(),
  capitalSocial: z.string(),
  iban: z.string(),
  bank: z.string(),
  phone: z.string(),
  email: z.string(),
  // Also the eligibility threshold for public tenders (jobs/tender-watch-sync.ts). Kept as a
  // string like the rest of the sheet and parsed where the number matters.
  annualTurnoverRon: z.string(),
  vatPayer: z.boolean(),
  // Signs the contracts.
  representative: z.string(),
  // The person filing the VAT declarations (D301/D390), who is not always the representative.
  declarant: z.object({ firstName: z.string(), lastName: z.string(), role: z.string() }),
  registeredOffice: CompanyAddressSchema,
  workLocations: z.array(CompanyLocationSchema),
})

export type CompanyProfile = z.infer<typeof CompanyProfileSchema>

const EMPTY_ADDRESS = { county: '', city: '', street: '', number: '', details: '', postalCode: '' }

export const EMPTY_COMPANY_PROFILE: CompanyProfile = {
  name: '',
  cui: '',
  vatIntraCode: '',
  regCom: '',
  caenCode: '',
  capitalSocial: '',
  iban: '',
  bank: '',
  phone: '',
  email: '',
  annualTurnoverRon: '',
  vatPayer: false,
  representative: '',
  declarant: { firstName: '', lastName: '', role: '' },
  registeredOffice: EMPTY_ADDRESS,
  workLocations: [],
}

export interface Company {
  id: string
  country: string
  timeZone: string
  currency: string
  profile: CompanyProfile
}

/** A stored sheet over the empty one, so a field added later reads as '' instead of undefined. */
export function normalizeProfile(stored: Record<string, unknown>): CompanyProfile {
  const merged = {
    ...EMPTY_COMPANY_PROFILE,
    ...stored,
    declarant: { ...EMPTY_COMPANY_PROFILE.declarant, ...(stored.declarant as object | undefined) },
    registeredOffice: { ...EMPTY_ADDRESS, ...(stored.registeredOffice as object | undefined) },
    workLocations: ((stored.workLocations as object[] | undefined) ?? []).map((loc) => ({ ...EMPTY_ADDRESS, ...loc })),
  }
  return CompanyProfileSchema.parse(merged)
}

export async function getCompany(tenantId: string = currentTenantId()): Promise<Company> {
  const [row] = await db
    .select({ id: tenants.id, country: tenants.country, timeZone: tenants.timeZone, currency: tenants.currency, profile: tenants.profile })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
  if (!row) throw new Error(`tenant ${tenantId} not found`)
  return { ...row, profile: normalizeProfile(row.profile) }
}

export async function getCompanyTimeZone(): Promise<string> {
  return (await getCompany()).timeZone
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone })
    return true
  } catch {
    return false
  }
}

/** Carries a 400 to the error handler in app.ts. */
export class CompanySettingsError extends Error {
  readonly statusCode = 400
}

export async function updateCompany(input: { profile: CompanyProfile; timeZone: string; currency: string }): Promise<Company> {
  if (!isValidTimeZone(input.timeZone)) {
    throw new CompanySettingsError(tr('errors.company.invalidTimeZone', { timeZone: input.timeZone }))
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new CompanySettingsError(tr('errors.company.invalidCurrency'))
  await db
    .update(tenants)
    .set({ profile: input.profile, timeZone: input.timeZone, currency: input.currency, updatedAt: new Date() })
    .where(eq(tenants.id, currentTenantId()))
  return getCompany()
}

export interface Seller {
  name: string
  cui: string
  country: string
  address: SellerAddress
}

/** Who issues the invoice or files the declaration. Throws when the sheet cannot say. */
export function requireSeller(company: Company): Seller {
  const missing = [!company.profile.name.trim() && 'name', !company.profile.cui.trim() && 'cui'].filter(
    (field): field is 'name' | 'cui' => Boolean(field),
  )
  if (missing.length) throw new CompanyProfileIncompleteError(missing)
  return {
    name: company.profile.name,
    cui: company.profile.cui,
    country: company.country,
    address: getCountryPack(company.country).sellerAddress(company.profile.registeredOffice),
  }
}
