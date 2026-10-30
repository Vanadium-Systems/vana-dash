// Once per test run: the invoices, declarations and contracts read the company sheet from the
// owner's `tenants` row, so the test database gets an invented one when it has none yet.
const TEST_COMPANY = {
  name: 'Test Company SRL',
  cui: 'RO12345678',
  regCom: 'J40/1/2020',
  iban: 'RO49AAAA1B31007593840000',
  bank: 'Test Bank',
  email: 'office@example.com',
  registeredOffice: { county: 'BUCURESTI', city: 'Bucuresti', street: 'Str. Test nr. 1', number: '', details: '', postalCode: '' },
}

export default async function setup(): Promise<void> {
  await import('./setup.js')
  const { and, eq, sql: raw } = await import('drizzle-orm')
  const { db, sql } = await import('../src/shared/db/client.js')
  const { tenants } = await import('../src/shared/db/schema/index.js')
  const { EMPTY_COMPANY_PROFILE } = await import('../src/shared/lib/company.js')
  const { getOwnerTenantId } = await import('../src/shared/lib/tenancy.js')
  try {
    await db
      .update(tenants)
      .set({ profile: { ...EMPTY_COMPANY_PROFILE, ...TEST_COMPANY } })
      .where(and(eq(tenants.id, getOwnerTenantId()), raw`${tenants.profile} = '{}'::jsonb`))
  } catch (err) {
    // Unit tests run without a database too; only the tests that need one will fail.
    console.warn(`[global-setup] company sheet not written, no database? ${String(err)}`)
  } finally {
    await sql.end()
  }
}
