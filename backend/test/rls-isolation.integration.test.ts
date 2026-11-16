/**
 * Part K, QA-K7: a second company next to the owner, with RLS on. Only meaningful with
 * RLS_ENABLED=true on the vanadash_app role (without RLS nothing in the database isolates, so the
 * suite skips). Two levels: every table read as company B shows none of the owner's rows and
 * refuses a row written for the owner; and B's people go through the flows that start without a
 * session (invitation, login, refresh, reset) and see none of the owner's data over HTTP.
 */
import argon2 from 'argon2'
import { and, eq, sql as rawSql } from 'drizzle-orm'
import type { LightMyRequestResponse } from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../src/shared/lib/email.js', () => ({ sendEmail: vi.fn(async () => {}) }))

import { buildServer } from '../src/app.js'
import { createTenant } from '../src/modules/tenants/service.js'
import { config } from '../src/shared/config.js'
import { db, sql } from '../src/shared/db/client.js'
import { billingClients, roles, tenants, userTokens, users } from '../src/shared/db/schema/index.js'
import { resolveFeatureKey } from '../src/shared/lib/features.js'
import { createUserToken } from '../src/shared/lib/user-tokens.js'
import { getOwnerTenantId, runAsTenant, withRlsBypass } from '../src/shared/lib/tenancy.js'

const RUN = Math.random().toString(36).slice(2, 8)
const PASSWORD = 'parola-firma-b-123'
const NEW_PASSWORD = 'parola-noua-firma-b-123'
let app: Awaited<ReturnType<typeof buildServer>>
let tenantB = ''
let userB = { id: '', email: `admin-b-${RUN}@example.com` }
let ownerClientId = ''

function cookieOf(res: LightMyRequestResponse, name: string): string {
  const cookie = res.cookies.find((c) => c.name === name)
  if (!cookie) throw new Error(`no ${name} cookie`)
  return `${name}=${cookie.value}`
}

async function tenantTables(): Promise<string[]> {
  const rows = await sql<{ table_name: string }[]>`
    select c.table_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'tenant_id' and t.table_type = 'BASE TABLE'
      and c.table_name <> 'platform_access_log'
    order by 1`
  return rows.map((r) => r.table_name)
}

describe.skipIf(!config.rlsEnabled)('two companies with RLS on', () => {
  beforeAll(async () => {
    app = await buildServer()
    await app.ready()
    tenantB = (await createTenant({ name: `Acme B ${RUN}` })).id
    // A new company starts with no features; the platform admin turns on what it may use.
    const clientsFeature = resolveFeatureKey('GET', '/api/invoicing/clients')!
    await withRlsBypass(() => db.update(tenants).set({ features: [clientsFeature] }).where(eq(tenants.id, tenantB)))
    const [adminRoleB] = await runAsTenant(tenantB, () => db.select({ id: roles.id }).from(roles).where(eq(roles.kind, 'admin')))
    const [row] = await runAsTenant(tenantB, () =>
      db
        .insert(users)
        .values({ email: userB.email, passwordHash: 'not-set', displayName: 'Admin B', roleId: adminRoleB!.id, status: 'invited' })
        .returning({ id: users.id }),
    )
    userB = { ...userB, id: row!.id }
    const [client] = await db
      .insert(billingClients)
      .values({ name: `Owner client ${RUN}`, cif: 'RO1', address: 'Str. Test 1' })
      .returning({ id: billingClients.id })
    ownerClientId = client!.id
  })

  afterAll(async () => {
    await db.delete(billingClients).where(eq(billingClients.id, ownerClientId))
    // Company B's rows in every table, then the company. Foreign keys between its rows decide the
    // order, so the tables are retried until a pass deletes nothing more.
    await withRlsBypass(async () => {
      const tables = await tenantTables()
      for (let pass = 0; pass < 5; pass++) {
        let failed = 0
        for (const table of tables) {
          try {
            await db.execute(rawSql`delete from ${rawSql.identifier(table)} where tenant_id = ${tenantB}`)
          } catch {
            failed++
          }
        }
        if (failed === 0) break
      }
      await db.execute(rawSql`delete from platform_access_log where tenant_id = ${tenantB}`)
      await db.execute(rawSql`delete from tenants where id = ${tenantB}`)
    })
    await app.close()
  })

  it('reads none of the owner rows from any table as company B', async () => {
    const owner = getOwnerTenantId()
    const tables = await tenantTables()
    expect(tables.length).toBeGreaterThan(100)
    const leaks: string[] = []
    let tablesWithOwnerRows = 0
    for (const table of tables) {
      const [asOwner] = await db.execute<{ n: number }>(rawSql`select count(*)::int as n from ${rawSql.identifier(table)} where tenant_id = ${owner}`)
      if (asOwner!.n > 0) tablesWithOwnerRows++
      const [asB] = await runAsTenant(tenantB, () =>
        db.execute<{ n: number }>(rawSql`select count(*)::int as n from ${rawSql.identifier(table)} where tenant_id <> ${tenantB}`),
      )
      if (asB!.n > 0) leaks.push(`${table}: ${asB!.n}`)
    }
    // The comparison only means something if the owner has data in many tables.
    expect(tablesWithOwnerRows).toBeGreaterThan(10)
    expect(leaks).toEqual([])
  })

  it("refuses a row written by company B for the owner, and B's insert lands in B", async () => {
    await expect(
      runAsTenant(tenantB, () =>
        db.insert(billingClients).values({ tenantId: getOwnerTenantId(), name: 'Forged', cif: 'RO2', address: 'x' }),
      ),
    ).rejects.toThrow()
    const [mine] = await runAsTenant(tenantB, () =>
      db.insert(billingClients).values({ name: `B client ${RUN}`, cif: 'RO3', address: 'x' }).returning({ tenantId: billingClients.tenantId }),
    )
    expect(mine!.tenantId).toBe(tenantB)
  })

  it("B's person accepts the invitation, logs in, refreshes and sees only B's data", async () => {
    const invite = await runAsTenant(tenantB, () => createUserToken(userB.id, 'invite'))
    const accepted = await app.inject({ method: 'POST', url: '/api/auth/accept-invite', payload: { token: invite, password: PASSWORD } })
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json().data.tenant.id).toBe(tenantB)

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: userB.email, password: PASSWORD }, remoteAddress: '10.22.0.1' })
    expect(login.statusCode).toBe(200)
    const session = cookieOf(login, 'vana_session')

    const refreshed = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: { cookie: cookieOf(login, 'vana_refresh') } })
    expect(refreshed.statusCode).toBe(200)

    const devices = await app.inject({ method: 'GET', url: '/api/me/sessions', headers: { cookie: session } })
    expect(devices.statusCode).toBe(200)
    expect(devices.json().data.length).toBeGreaterThanOrEqual(1)

    const clients = await app.inject({ method: 'GET', url: '/api/invoicing/clients', headers: { cookie: session } })
    expect(clients.statusCode).toBe(200)
    const ids = (clients.json().data as Array<{ id: string }>).map((c) => c.id)
    expect(ids).not.toContain(ownerClientId)
  })

  it("B's person asks for a reset link and resets the password", async () => {
    const forgot = await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: userB.email }, remoteAddress: '10.22.0.2' })
    expect(forgot.statusCode).toBe(204)
    await vi.waitFor(async () => {
      const rows = await withRlsBypass(() =>
        db.select({ tenantId: userTokens.tenantId }).from(userTokens).where(and(eq(userTokens.userId, userB.id), eq(userTokens.kind, 'reset'))),
      )
      expect(rows.map((r) => r.tenantId)).toContain(tenantB)
    })

    const token = await runAsTenant(tenantB, () => createUserToken(userB.id, 'reset'))
    const reset = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token, password: NEW_PASSWORD }, remoteAddress: '10.22.0.3' })
    expect(reset.statusCode).toBe(204)
    const [row] = await runAsTenant(tenantB, () => db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userB.id)))
    expect(await argon2.verify(row!.passwordHash, NEW_PASSWORD)).toBe(true)
  })
})
