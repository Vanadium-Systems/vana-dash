import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { supplierParty } from '../../connectors/anaf/supplier.js'
import { db } from '../db/client.js'
import { tenants } from '../db/schema/index.js'
import { EMPTY_COMPANY_PROFILE, getCompany } from './company.js'
import { importCompanyProfileFromEnv, mergeLegacyProfile } from './company-env-import.js'
import { getOwnerTenantId } from './tenancy.js'

const ENV = {
  COMPANY_NAME: 'Acme SRL',
  COMPANY_CIF: '12345678',
  COMPANY_REG_COM: 'J40/1/2020',
  COMPANY_ADDRESS: 'Str. Exemplu nr. 1, bl. A',
  COMPANY_CITY: 'SECTOR3',
  COMPANY_COUNTY_CODE: 'RO-B',
  COMPANY_IBAN: 'RO49AAAA1B31007593840000',
  COMPANY_BANK: 'Test Bank',
  COMPANY_EMAIL: 'office@example.com',
  COMPANY_VAT_PAYER: 'false',
  DECLARANT_FIRST_NAME: 'Ion',
  DECLARANT_LAST_NAME: 'Popescu',
}

describe('mergeLegacyProfile', () => {
  it('lets the env win over the old settings sheet and says on which fields', () => {
    const oldSheet = { ...EMPTY_COMPANY_PROFILE, name: 'Acme', caenCode: '6201', registeredOffice: { county: 'Ilfov', city: 'Voluntari', street: 'Str. Alta', number: '2', details: '' } }
    const { profile, overridden } = mergeLegacyProfile(oldSheet, ENV)
    expect(profile.name).toBe('Acme SRL')
    expect(profile.caenCode).toBe('6201')
    expect(profile.registeredOffice).toEqual({ county: 'BUCURESTI', city: 'SECTOR3', street: 'Str. Exemplu nr. 1, bl. A', number: '', details: '', postalCode: '' })
    expect(profile.declarant).toEqual({ firstName: 'Ion', lastName: 'Popescu', role: 'Administrator' })
    expect(overridden.sort()).toEqual(['name', 'registeredOffice'])
  })

  it('keeps the old sheet as it was when the env is empty', () => {
    const oldSheet = { ...EMPTY_COMPANY_PROFILE, name: 'Acme', phone: '0700000000' }
    expect(mergeLegacyProfile(oldSheet, {}).profile).toEqual({ ...EMPTY_COMPANY_PROFILE, name: 'Acme', phone: '0700000000' })
  })
})

describe('importCompanyProfileFromEnv', () => {
  const ownerId = getOwnerTenantId()
  let saved: Record<string, unknown>

  beforeAll(async () => {
    const [row] = await db.select({ profile: tenants.profile }).from(tenants).where(eq(tenants.id, ownerId))
    saved = row!.profile
  })

  afterAll(async () => {
    await db.update(tenants).set({ profile: saved }).where(eq(tenants.id, ownerId))
  })

  it('fills an empty sheet once, and the invoice supplier comes out as it did from env', async () => {
    await db.update(tenants).set({ profile: {} }).where(eq(tenants.id, ownerId))
    await importCompanyProfileFromEnv(ENV)

    // What loadInvoiceInput built from config.company before 2026-10-29.
    expect(supplierParty(await getCompany(ownerId))).toEqual({
      name: 'Acme SRL',
      cif: '12345678',
      regCom: 'J40/1/2020',
      address: 'Str. Exemplu nr. 1, bl. A',
      city: 'SECTOR3',
      countyCode: 'RO-B',
      country: 'RO',
      iban: 'RO49AAAA1B31007593840000',
      bank: 'Test Bank',
      email: 'office@example.com',
    })

    await importCompanyProfileFromEnv({ ...ENV, COMPANY_NAME: 'Other SRL' })
    expect((await getCompany(ownerId)).profile.name).toBe('Acme SRL')
  })
})
