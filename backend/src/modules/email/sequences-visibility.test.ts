import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../shared/lib/email.js', () => ({ sendEmail: vi.fn(async () => {}) }))

import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { emailSequenceEnrollments, emailSequences, prospects, roles, users } from '../../shared/db/schema/index.js'

const app = await buildServer()
await app.ready()

const passwordHash = await argon2.hash('parola-de-test-123')
const stamp = Date.now()
const userIds: string[] = []
const roleIds: string[] = []

async function createPerson(label: string, features: string[]) {
  const [role] = await db.insert(roles).values({ name: `QA seq vis ${label}: ${stamp}`, kind: 'custom', features }).returning()
  roleIds.push(role!.id)
  const [person] = await db
    .insert(users)
    .values({ email: `qa-seq vis-${label}-${stamp}@example.com`, passwordHash, displayName: `QA ${label}`, roleId: role!.id })
    .returning()
  userIds.push(person!.id)
  return { person: person!, cookie: app.jwt.sign({ sub: person!.id, sv: person!.sessionVersion }) }
}

const get = (url: string, cookie: string) => app.inject({ method: 'GET', url, cookies: { vana_session: cookie } })

const colleagueA = await createPerson('a', ['email.view', 'email.bulk', 'clienti.view'])
const colleagueB = await createPerson('b', ['email.view', 'email.bulk', 'clienti.view'])
const seesAll = await createPerson('all', ['email.view', 'email.bulk', 'clienti.view', 'clienti.toti'])

const [sequence] = await db.insert(emailSequences).values({ name: `QA seq ${stamp}`, fromIdentity: 'vanadium' }).returning()
const [prospect] = await db.insert(prospects).values({ name: `Acme ${stamp}`, assignedUserId: colleagueA.person.id }).returning()
await db.insert(emailSequenceEnrollments).values([
  { sequenceId: sequence!.id, prospectId: prospect!.id, recipientEmail: `owned-${stamp}@example.com` },
  { sequenceId: sequence!.id, recipientEmail: `typed-${stamp}@example.com` },
])

afterAll(async () => {
  await db.delete(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.sequenceId, sequence!.id))
  await db.delete(emailSequences).where(eq(emailSequences.id, sequence!.id))
  await db.delete(prospects).where(eq(prospects.id, prospect!.id))
  await db.delete(users).where(inArray(users.id, userIds))
  await db.delete(roles).where(inArray(roles.id, roleIds))
  await app.close()
})

const recipients = async (cookie: string) => {
  const res = await get(`/api/email/sequences/${sequence!.id}/enrollments`, cookie)
  expect(res.statusCode).toBe(200)
  return (res.json().data as Array<{ recipientEmail: string }>).map((row) => row.recipientEmail)
}

describe('sequence enrollments visibility', () => {
  it('lists an enrollment of someone else\'s prospect only to people who see the prospect', async () => {
    expect(await recipients(colleagueB.cookie)).toEqual([`typed-${stamp}@example.com`])
    expect(await recipients(colleagueA.cookie)).toContain(`owned-${stamp}@example.com`)
    expect(await recipients(seesAll.cookie)).toContain(`owned-${stamp}@example.com`)
  })
})
