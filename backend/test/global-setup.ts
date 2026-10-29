// Once per test run: the invoices, declarations and contracts read the company sheet from the
// database, so the test database gets the invented COMPANY_* values from setup.ts, the way a
// production database got the real ones on its first start after the upgrade.
export default async function setup(): Promise<void> {
  await import('./setup.js')
  const { importCompanyProfileFromEnv } = await import('../src/shared/lib/company-env-import.js')
  const { sql } = await import('../src/shared/db/client.js')
  await importCompanyProfileFromEnv()
  await sql.end()
}
