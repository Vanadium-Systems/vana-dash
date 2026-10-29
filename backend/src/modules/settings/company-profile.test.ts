/**
 * The company sheet, opened and saved by a colleague whose role has only Settings → Company
 * (the "test as an employee" step of the sprint profile), and what /me says afterwards.
 */
import argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { roles, tenants, users } from '../../shared/db/schema/index.js'
import { getOwnerTenantId } from '../../shared/lib/tenancy.js'

const app = await buildServer()
await app.ready()

const [role] = await db
  .insert(roles)
  .values({ name: `QA company sheet ${Date.now()}`, kind: 'custom', features: ['setari.view', 'setari.firma'] })
  .returning()
const [colleague] = await db
  .insert(users)
  .values({ email: `qa-company-${Date.now()}@example.com`, passwordHash: await argon2.hash('test-password-123'), roleId: role!.id })
  .returning()
const token = await app.jwt.sign({ sub: colleague!.id, sv: colleague!.sessionVersion })

const ownerId = getOwnerTenantId()
const [before] = await db.select().from(tenants).where(eq(tenants.id, ownerId))

afterAll(async () => {
  await db
    .update(tenants)
    .set({ profile: before!.profile, timeZone: before!.timeZone, currency: before!.currency })
    .where(eq(tenants.id, ownerId))
  await db.delete(users).where(eq(users.id, colleague!.id))
  await db.delete(roles).where(eq(roles.id, role!.id))
  await app.close()
})

const call = (method: 'GET' | 'PUT', url: string, payload?: object) =>
  app.inject({ method, url, payload, cookies: { vana_session: token } })

describe('the company sheet for a colleague with setari.firma', () => {
  it('opens with the country, the time zone and the currency', async () => {
    const res = await call('GET', '/api/settings/company-profile')
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ country: 'RO', countries: ['RO'], timeZone: before!.timeZone, currency: before!.currency })
  })

  it('saves, and /me carries the new time zone', async () => {
    const { profile } = (await call('GET', '/api/settings/company-profile')).json().data
    const res = await call('PUT', '/api/settings/company-profile', {
      profile: { ...profile, representative: 'Ion Popescu' },
      timeZone: 'Europe/Lisbon',
      currency: 'EUR',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.profile.representative).toBe('Ion Popescu')

    const me = (await call('GET', '/api/auth/me')).json().data
    expect(me.tenant).toMatchObject({ country: 'RO', timeZone: 'Europe/Lisbon', currency: 'EUR' })
  })

  it('refuses a time zone that does not exist', async () => {
    const { profile } = (await call('GET', '/api/settings/company-profile')).json().data
    const res = await call('PUT', '/api/settings/company-profile', { profile, timeZone: 'Europe/Atlantis', currency: 'RON' })
    expect(res.statusCode).toBe(400)
  })
})
