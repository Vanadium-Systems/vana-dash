/**
 * "Meet with the prospect" over HTTP on a real Postgres: duration, place and colleagues on the
 * calendar event, who may be invited, SEQUENCE on move / cancel, and the .ics route.
 */
import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { calendarEventAttendees, calendarEvents, notifications, prospectContactPoints, prospectPeople, prospects, prospectTasks, roles, users } from '../../shared/db/schema/index.js'

const app = await buildServer()
await app.ready()

const RUN = randomUUID().slice(0, 8)
const AGENT = ['clienti.view', 'clienti.prospectare']

const userIds: string[] = []
const roleIds: string[] = []
const prospectIds: string[] = []

interface Person {
  id: string
  token: string
}

async function makePerson(label: string, features: string[]): Promise<Person> {
  const [role] = await db.insert(roles).values({ name: `QA meet ${label} ${RUN}`, kind: 'custom', features }).returning()
  roleIds.push(role!.id)
  const [row] = await db
    .insert(users)
    .values({ email: `${label}-${RUN}@example.com`, passwordHash: await argon2.hash('acme-test-password'), displayName: `QA ${label}`, roleId: role!.id })
    .returning()
  userIds.push(row!.id)
  return { id: row!.id, token: await app.jwt.sign({ sub: row!.id, sv: 1 }) }
}

const call = (who: Person, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, cookies: { vana_session: who.token }, payload })

let host: Person
let withCommon: Person
let colleague: Person
let stranger: Person
let acme: string
let other: string
const okEmail = `ion-${RUN}@acme.example`
const companyEmail = `office-${RUN}@acme.example`
const blockedEmail = `nu-${RUN}@acme.example`
const START = '2031-03-03T08:00:00.000Z'

beforeAll(async () => {
  host = await makePerson('host', AGENT)
  withCommon = await makePerson('common', [...AGENT, 'calendar.view', 'calendar.comune'])
  colleague = await makePerson('colleague', ['calendar.view'])
  stranger = await makePerson('stranger', AGENT)
  const rows = await db
    .insert(prospects)
    .values([
      { name: `QAMT ${RUN} Acme`, assignedUserId: host.id },
      { name: `QAMT ${RUN} Other`, assignedUserId: withCommon.id },
    ])
    .returning()
  acme = rows[0]!.id
  other = rows[1]!.id
  prospectIds.push(acme, other)
  const [ion, blocked] = await db
    .insert(prospectPeople)
    .values([
      { prospectId: acme, name: 'Ion Pop' },
      { prospectId: acme, name: 'Nu Contacta', doNotContact: true },
    ])
    .returning()
  await db.insert(prospectContactPoints).values([
    { prospectId: acme, personId: ion!.id, kind: 'email', value: okEmail, valueNormalized: okEmail },
    { prospectId: acme, kind: 'email', value: companyEmail, valueNormalized: companyEmail },
    { prospectId: acme, personId: blocked!.id, kind: 'email', value: blockedEmail, valueNormalized: blockedEmail },
  ])
  // `host` needs calendar.comune only for the colleague cases: those go through `withCommon`.
  await db.update(prospects).set({ assignedUserId: withCommon.id }).where(eq(prospects.id, acme))
})

afterAll(async () => {
  const taskRows = await db.select({ eventId: prospectTasks.calendarEventId }).from(prospectTasks).where(inArray(prospectTasks.prospectId, prospectIds))
  const eventIds = taskRows.flatMap((t) => (t.eventId ? [t.eventId] : []))
  if (eventIds.length) await db.delete(calendarEvents).where(inArray(calendarEvents.id, eventIds))
  if (userIds.length) await db.delete(notifications).where(inArray(notifications.userId, userIds))
  if (prospectIds.length) await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  if (userIds.length) await db.delete(users).where(inArray(users.id, userIds))
  if (roleIds.length) await db.delete(roles).where(inArray(roles.id, roleIds))
})

const meeting = (extra: object = {}) => ({ kind: 'meeting', title: 'Meeting with Acme', dueAt: START, ...extra })

async function createMeeting(extra: object = {}) {
  const res = await call(withCommon, 'POST', `/api/prospects/${acme}/tasks`, meeting(extra))
  return { res, task: res.json().data }
}

describe('meeting create', () => {
  it('uses the duration and place on the calendar event and returns them on the task', async () => {
    const { res, task } = await createMeeting({ durationMinutes: 45, location: 'Office, 2nd floor', invitees: [okEmail.toUpperCase()] })
    expect(res.statusCode).toBe(201)
    expect(task).toMatchObject({ durationMinutes: 45, location: 'Office, 2nd floor', invitees: [okEmail], inviteSequence: 0, attendeeUserIds: [] })
    const [event] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, task.calendarEventId))
    expect(event!.endAt.getTime() - event!.startAt.getTime()).toBe(45 * 60_000)
    expect(event!.location).toBe('Office, 2nd floor')
  })

  it('defaults to 30 minutes', async () => {
    const { task } = await createMeeting()
    expect(task.durationMinutes).toBe(30)
  })

  it('adds colleagues as attendees (owner left out, no duplicates) and notifies them but not the caller', async () => {
    const { res, task } = await createMeeting({ attendeeUserIds: [colleague.id, colleague.id, withCommon.id] })
    expect(res.statusCode).toBe(201)
    expect(task.attendeeUserIds).toEqual([colleague.id])
    const rows = await db.select().from(calendarEventAttendees).where(and(eq(calendarEventAttendees.eventId, task.calendarEventId), isNull(calendarEventAttendees.deletedAt)))
    expect(rows.map((r) => r.userId)).toEqual([colleague.id])
    const bell = await db.select().from(notifications).where(and(eq(notifications.userId, colleague.id), eq(notifications.kind, 'clienti.meeting')))
    expect(bell.length).toBeGreaterThan(0)
    expect(bell.at(-1)!.url).toBe(`/clients?prospect=${acme}`)
    const own = await db.select().from(notifications).where(and(eq(notifications.userId, withCommon.id), eq(notifications.kind, 'clienti.meeting')))
    expect(own).toHaveLength(0)
  })

  it('403 when inviting colleagues without calendar.comune', async () => {
    const mine = (await db.insert(prospects).values({ name: `QAMT ${RUN} Mine`, assignedUserId: host.id }).returning())[0]!.id
    prospectIds.push(mine)
    const res = await call(host, 'POST', `/api/prospects/${mine}/tasks`, meeting({ attendeeUserIds: [colleague.id] }))
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('CALENDAR_COMUNE_REQUIRED')
    expect((await call(host, 'POST', `/api/prospects/${mine}/tasks`, meeting({ attendeeUserIds: [] }))).statusCode).toBe(201)
  })

  it('400 for an attendee that is not an active user', async () => {
    const res = await call(withCommon, 'POST', `/api/prospects/${acme}/tasks`, meeting({ attendeeUserIds: [randomUUID()] }))
    expect(res.statusCode).toBe(400)
  })

  it('400 INVITEE_NOT_ALLOWED for an address that is not a contact of the prospect', async () => {
    const res = await call(withCommon, 'POST', `/api/prospects/${acme}/tasks`, meeting({ invitees: ['someone@elsewhere.example'] }))
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('INVITEE_NOT_ALLOWED')
  })

  it('400 INVITEE_NOT_ALLOWED for a do-not-contact person, and accepts a company-level address', async () => {
    const blocked = await call(withCommon, 'POST', `/api/prospects/${acme}/tasks`, meeting({ invitees: [blockedEmail] }))
    expect(blocked.statusCode).toBe(400)
    expect(blocked.json().error.code).toBe('INVITEE_NOT_ALLOWED')
    expect((await call(withCommon, 'POST', `/api/prospects/${acme}/tasks`, meeting({ invitees: [companyEmail, okEmail] }))).statusCode).toBe(201)
  })
})

describe('move and cancel', () => {
  it('a move raises SEQUENCE when there are invitees and updates the event', async () => {
    const { task } = await createMeeting({ invitees: [okEmail], durationMinutes: 30 })
    const moved = await call(withCommon, 'PATCH', `/api/prospects/${acme}/tasks/${task.id}`, { dueAt: '2031-03-04T10:00:00.000Z', durationMinutes: 60, location: 'Online' })
    expect(moved.statusCode).toBe(200)
    expect(moved.json().data).toMatchObject({ inviteSequence: 1, durationMinutes: 60, location: 'Online' })
    const [event] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, task.calendarEventId))
    expect(event!.startAt.toISOString()).toBe('2031-03-04T10:00:00.000Z')
    expect(event!.endAt.toISOString()).toBe('2031-03-04T11:00:00.000Z')
    // A title-only edit moves nothing, so the invitation stays as it is.
    const renamed = await call(withCommon, 'PATCH', `/api/prospects/${acme}/tasks/${task.id}`, { title: 'Renamed' })
    expect(renamed.json().data.inviteSequence).toBe(1)
  })

  it('a move without invitees leaves SEQUENCE at 0', async () => {
    const { task } = await createMeeting()
    const moved = await call(withCommon, 'PATCH', `/api/prospects/${acme}/tasks/${task.id}`, { dueAt: '2031-03-05T10:00:00.000Z' })
    expect(moved.json().data.inviteSequence).toBe(0)
  })

  it('changing the colleagues replaces the attendees and notifies only the new ones', async () => {
    const { task } = await createMeeting()
    const before = (await db.select().from(notifications).where(eq(notifications.userId, colleague.id))).length
    const res = await call(withCommon, 'PATCH', `/api/prospects/${acme}/tasks/${task.id}`, { attendeeUserIds: [colleague.id] })
    expect(res.json().data.attendeeUserIds).toEqual([colleague.id])
    expect((await db.select().from(notifications).where(eq(notifications.userId, colleague.id))).length).toBe(before + 1)
    await call(withCommon, 'PATCH', `/api/prospects/${acme}/tasks/${task.id}`, { attendeeUserIds: [colleague.id], location: 'x' })
    expect((await db.select().from(notifications).where(eq(notifications.userId, colleague.id))).length).toBe(before + 1)
  })

  it('cancel soft-deletes the event, raises SEQUENCE and serves a CANCEL .ics', async () => {
    const { task } = await createMeeting({ invitees: [okEmail] })
    expect((await call(withCommon, 'DELETE', `/api/prospects/${acme}/tasks/${task.id}`)).statusCode).toBe(200)
    const [event] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, task.calendarEventId))
    expect(event!.deletedAt).not.toBeNull()
    const [row] = await db.select().from(prospectTasks).where(eq(prospectTasks.id, task.id))
    expect(row!.inviteSequence).toBe(1)

    const ics = await call(withCommon, 'GET', `/api/prospects/${acme}/tasks/${task.id}/invite.ics?method=cancel`)
    expect(ics.statusCode).toBe(200)
    expect(ics.json().data).toMatchObject({ uid: `${task.id}@vanadash`, sequence: 1 })
    const text = Buffer.from(ics.json().data.content, 'base64').toString()
    expect(text).toContain('METHOD:CANCEL')
    expect(text).toContain('STATUS:CANCELLED')
    // A live meeting has nothing to cancel, a deleted one nothing to request.
    const { task: live } = await createMeeting()
    expect((await call(withCommon, 'GET', `/api/prospects/${acme}/tasks/${live.id}/invite.ics?method=cancel`)).statusCode).toBe(404)
    expect((await call(withCommon, 'GET', `/api/prospects/${acme}/tasks/${task.id}/invite.ics`)).statusCode).toBe(404)
  })
})

describe('invite.ics route', () => {
  it('serves a REQUEST with the event time in UTC, place, organizer and attendees by name', async () => {
    const { task } = await createMeeting({ invitees: [okEmail, companyEmail], durationMinutes: 45, location: 'Office, 2nd floor', description: 'Agenda' })
    const res = await call(withCommon, 'GET', `/api/prospects/${acme}/tasks/${task.id}/invite.ics?method=request&from=main`)
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect(data.filename).toMatch(/\.ics$/)
    const text = Buffer.from(data.content, 'base64').toString().replace(/\r\n /g, '')
    expect(text).toContain('METHOD:REQUEST')
    expect(text).toContain('DTSTART:20310303T080000Z')
    expect(text).toContain('DTEND:20310303T084500Z')
    expect(text).toContain('LOCATION:Office\\, 2nd floor')
    expect(text).toContain(`ORGANIZER;CN="QA common":mailto:common-${RUN}@example.com`)
    expect(text).toContain(`CN="Ion Pop";RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:${okEmail}`)
    expect(text).toContain(`ATTENDEE;RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:${companyEmail}`)
  })

  it('404 for a prospect the caller cannot see, a task of another prospect and a task that is not a meeting', async () => {
    const { task } = await createMeeting()
    expect((await call(stranger, 'GET', `/api/prospects/${acme}/tasks/${task.id}/invite.ics`)).statusCode).toBe(404)
    expect((await call(withCommon, 'GET', `/api/prospects/${other}/tasks/${task.id}/invite.ics`)).statusCode).toBe(404)
    const plain = await call(withCommon, 'POST', `/api/prospects/${acme}/tasks`, { kind: 'call', title: 'Call', dueAt: START })
    expect((await call(withCommon, 'GET', `/api/prospects/${acme}/tasks/${plain.json().data.id}/invite.ics`)).statusCode).toBe(404)
  })
})
