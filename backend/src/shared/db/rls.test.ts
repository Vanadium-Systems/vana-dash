import { describe, expect, it } from 'vitest'
import { sql } from './client.js'

// Tables with a tenant_id that are not a company's data. Each one says why.
const NOT_ISOLATED: Record<string, string> = {
  platform_access_log: "the platform's log of what its admins opened; tenant_id is the company visited",
}

describe('row-level security on every company table', () => {
  it('has ENABLE + FORCE + the tenant_isolation policy', async () => {
    const rows = await sql<{ table: string; enabled: boolean; forced: boolean; policies: string[] }[]>`
      select c.relname as table, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
             coalesce(array_agg(p.polname) filter (where p.polname is not null), '{}') as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      left join pg_policy p on p.polrelid = c.oid
      where n.nspname = 'public' and c.relkind = 'r'
        and exists (select 1 from information_schema.columns k
                    where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'tenant_id')
      group by c.relname, c.relrowsecurity, c.relforcerowsecurity
      order by c.relname`
    expect(rows.length).toBeGreaterThan(100)
    const missing = rows
      .filter((r) => !(r.table in NOT_ISOLATED))
      .filter((r) => !r.enabled || !r.forced || !r.policies.includes('tenant_isolation'))
      .map((r) => `${r.table} (enabled=${r.enabled}, forced=${r.forced}, policies=${r.policies.join(',') || '-'})`)
    expect(missing).toEqual([])
  })

  it('the app role, where it exists, cannot bypass the policies', async () => {
    const roles = await sql<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      select rolsuper, rolbypassrls from pg_roles where rolname = 'vanadash_app'`
    for (const role of roles) expect(role).toEqual({ rolsuper: false, rolbypassrls: false })
  })
})
