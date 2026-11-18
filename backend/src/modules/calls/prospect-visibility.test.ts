import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../shared/lib/email.js', () => ({ sendEmail: vi.fn(async () => {}) }))

import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { calls, prospects, roles, users } from '../../shared/db/schema/index.js'
import { sessionToken } from '../../shared/testing/session-token.js'

const app = await buildServer()
await app.ready()

const passwordHash = await argon2.hash('parola-de-test-123')
const stamp = Date.now()
const userIds: string[] = []
const roleIds: string[] = []

async function createPerson(label: string, features: string[]) {
  const [role] = await db.insert(roles).values({ name: `QA call vis ${label}: ${stamp}`, kind: 'custom', features }).returning()
  roleIds.push(role!.id)
  const [person] = await db
    .insert(users)
    .values({ email: `qa-call vis-${label}-${stamp}@example.com`, passwordHash, displayName: `QA ${label}`, roleId: role!.id })
    .returning()
  userIds.push(person!.id)
  return { person: person!, cookie: await sessionToken(app, person!.id, person!.sessionVersion) }
}

const get = (url: string, cookie: string) => app.inject({ method: 'GET', url, cookies: { vana_session: cookie } })

const colleagueA = await createPerson('a', ['apeluri.view', 'clienti.view'])
const colleagueB = await createPerson('b', ['apeluri.view', 'clienti.view'])

const [prospect] = await db.insert(prospects).values({ name: `Acme ${stamp}`, assignedUserId: colleagueA.person.id }).returning()
const [call] = await db
  .insert(calls)
  .values({
    title: `QA call ${stamp}`,
    roomName: `qa-room-${stamp}`,
    publicId: `qa${stamp}`,
    expiresAt: new Date(Date.now() + 3_600_000),
    prospectId: prospect!.id,
  })
  .returning()

afterAll(async () => {
  await db.delete(calls).where(eq(calls.id, call!.id))
  await db.delete(prospects).where(eq(prospects.id, prospect!.id))
  await db.delete(users).where(inArray(users.id, userIds))
  await db.delete(roles).where(inArray(roles.id, roleIds))
  await app.close()
})

const prospectOf = async (cookie: string) => {
  const res = await get('/api/calls?status=all&limit=200', cookie)
  expect(res.statusCode).toBe(200)
  const row = (res.json().data as Array<{ id: string; prospect: { name: string } | null }>).find((item) => item.id === call!.id)
  expect(row).toBeDefined()
  return row!.prospect
}

describe('calls prospect visibility', () => {
  it('shows the call to everyone but the prospect name only to who sees the prospect', async () => {
    expect(await prospectOf(colleagueB.cookie)).toBeNull()
    expect((await prospectOf(colleagueA.cookie))?.name).toBe(`Acme ${stamp}`)
  })
})
