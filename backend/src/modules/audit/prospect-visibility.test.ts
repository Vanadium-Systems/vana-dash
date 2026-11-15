import argon2 from 'argon2'
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.mock('../../shared/lib/email.js', () => ({ sendEmail: vi.fn(async () => {}) }))

import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { auditLog, prospects, roles, users } from '../../shared/db/schema/index.js'

const app = await buildServer()
await app.ready()

const passwordHash = await argon2.hash('parola-de-test-123')
const stamp = Date.now()
const userIds: string[] = []
const roleIds: string[] = []

async function createPerson(label: string, features: string[]) {
  const [role] = await db.insert(roles).values({ name: `QA audit vis ${label}: ${stamp}`, kind: 'custom', features }).returning()
  roleIds.push(role!.id)
  const [person] = await db
    .insert(users)
    .values({ email: `qa-audit vis-${label}-${stamp}@example.com`, passwordHash, displayName: `QA ${label}`, roleId: role!.id })
    .returning()
  userIds.push(person!.id)
  return { person: person!, cookie: app.jwt.sign({ sub: person!.id, sv: person!.sessionVersion }) }
}

const get = (url: string, cookie: string) => app.inject({ method: 'GET', url, cookies: { vana_session: cookie } })

const colleagueA = await createPerson('a', ['echipa.istoric', 'clienti.view'])
const colleagueB = await createPerson('b', ['echipa.istoric', 'clienti.view'])
const seesAll = await createPerson('all', ['echipa.istoric', 'clienti.view', 'clienti.toti'])

const [prospect] = await db.insert(prospects).values({ name: `Acme ${stamp}`, assignedUserId: colleagueA.person.id }).returning()
const [freeProspect] = await db.insert(prospects).values({ name: `Free ${stamp}` }).returning()
const prospectIds = [prospect!.id, freeProspect!.id]

const shareActor = colleagueA.person.id
await db.insert(auditLog).values([
  { action: 'prospect.contact.adaugat', entityType: 'prospect', entityId: prospect!.id, actorUserId: colleagueA.person.id, changes: { phone: [null, '0700 000 000'] } },
  { action: 'prospect.modificat', entityType: 'prospect', entityId: freeProspect!.id, actorUserId: colleagueA.person.id, changes: { name: ['x', 'y'] } },
  { action: 'calendar.share.adaugat', entityType: 'calendar_share', entityId: shareActor, actorUserId: shareActor, changes: { calendar: [null, 'view'] } },
  { action: 'arhiva.share.adaugat', entityType: 'archive_folder', entityId: prospect!.id, actorUserId: shareActor, changes: { utilizator: [null, `view:${colleagueB.person.id}`] } },
])

afterAll(async () => {
  await db.delete(auditLog).where(inArray(auditLog.entityId, [...prospectIds, shareActor]))
  await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  await db.delete(users).where(inArray(users.id, userIds))
  await db.delete(roles).where(inArray(roles.id, roleIds))
  await app.close()
})

const actions = async (cookie: string) => {
  const res = await get('/api/audit?limit=200', cookie)
  expect(res.statusCode).toBe(200)
  return (res.json().data as Array<{ action: string; entityId: string | null }>).filter((row) => [...prospectIds, shareActor].includes(row.entityId ?? ''))
}

describe('audit visibility', () => {
  it('hides a prospect the person cannot see, keeps free ones', async () => {
    const rows = await actions(colleagueB.cookie)
    expect(rows.some((row) => row.entityId === prospect!.id && row.action.startsWith('prospect.'))).toBe(false)
    expect(rows.some((row) => row.entityId === freeProspect!.id)).toBe(true)
  })

  it('shows the assigned person their prospect and clienti.toti everything', async () => {
    expect((await actions(colleagueA.cookie)).some((row) => row.action === 'prospect.contact.adaugat')).toBe(true)
    expect((await actions(seesAll.cookie)).some((row) => row.action === 'prospect.contact.adaugat')).toBe(true)
  })

  it('share rows go to the actor, the target, and no one else', async () => {
    const forB = (await actions(colleagueB.cookie)).map((row) => row.action)
    expect(forB).toContain('arhiva.share.adaugat')
    expect(forB).not.toContain('calendar.share.adaugat')
    expect((await actions(colleagueA.cookie)).map((row) => row.action)).toContain('calendar.share.adaugat')
    expect((await actions(seesAll.cookie)).map((row) => row.action)).not.toContain('arhiva.share.adaugat')
  })
})
