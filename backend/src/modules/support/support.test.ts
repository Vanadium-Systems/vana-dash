/**
 * modules/support — integration test, pg real + server real (app.inject). Emailul (Resend)
 * e mockuit la graniță; pushul e no-op fără VAPID.
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const sendEmailMock = vi.fn(async (_opts: { to: string; subject: string; text: string }) => {})
vi.mock('../../shared/lib/email.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/lib/email.js')>()
  return { ...actual, sendEmail: (opts: { to: string; subject: string; text: string }) => sendEmailMock(opts) }
})

import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { supportTickets, users } from '../../shared/db/schema/index.js'

const app = await buildServer()
await app.ready()

const stamp = Date.now()
async function makeUser(label: string, isPlatformAdmin = false) {
  const [row] = await db
    .insert(users)
    .values({ email: `qa-suport-${label}-${stamp}@test.local`, passwordHash: 'x', displayName: `QA ${label}`, isPlatformAdmin })
    .returning()
  return { ...row!, token: await app.jwt.sign({ sub: row!.id, sv: row!.sessionVersion }) }
}

const ana = await makeUser('ana')
const bogdan = await makeUser('bogdan')
const platforma = await makeUser('platforma', true)
const userIds = [ana.id, bogdan.id, platforma.id]

afterAll(async () => {
  await db.delete(supportTickets).where(inArray(supportTickets.createdByUserId, userIds))
  await db.delete(users).where(inArray(users.id, userIds))
  await app.close()
})

beforeEach(() => sendEmailMock.mockClear())

type Who = typeof ana
const call = (who: Who, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  app.inject({ method, url, cookies: { vana_session: who.token }, ...(payload ? { payload } : {}) })

async function openTicket(who: Who, subject = 'Nu pot trimite un email') {
  const res = await call(who, 'POST', '/api/support/tickets', { subject, description: 'Butonul Trimite rămâne gri.', page: '/email' })
  expect(res.statusCode).toBe(201)
  return res.json().data as { id: string; status: string; unread: boolean; replies: unknown[] }
}

const emailsTo = (who: Who) => sendEmailMock.mock.calls.filter(([opts]) => opts.to === who.email)

describe('tichetele unui om', () => {
  it('cer sesiune', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/support/tickets' })).statusCode).toBe(401)
  })

  it('un tichet nou apare în lista autorului, cu pagina de unde a fost deschis', async () => {
    const ticket = await openTicket(ana)
    expect(ticket).toMatchObject({ status: 'deschis', unread: false, page: '/email', author: { id: ana.id, name: 'QA ana' }, replies: [] })
    const list = (await call(ana, 'GET', '/api/support/tickets')).json().data as Array<{ id: string }>
    expect(list.map((t) => t.id)).toContain(ticket.id)
  })

  it('tichetul altcuiva nu există: nici în listă, nici prin id, nici la răspuns sau închidere', async () => {
    const ticket = await openTicket(ana)
    const list = (await call(bogdan, 'GET', '/api/support/tickets')).json().data as Array<{ id: string }>
    expect(list.map((t) => t.id)).not.toContain(ticket.id)
    expect((await call(bogdan, 'GET', `/api/support/tickets/${ticket.id}`)).statusCode).toBe(404)
    expect((await call(bogdan, 'POST', `/api/support/tickets/${ticket.id}/replies`, { body: 'și eu' })).statusCode).toBe(404)
    expect((await call(bogdan, 'PATCH', `/api/support/tickets/${ticket.id}`, { status: 'inchis' })).statusCode).toBe(404)
  })

  it('respinge un tichet fără subiect sau fără descriere', async () => {
    expect((await call(ana, 'POST', '/api/support/tickets', { subject: '  ', description: 'x' })).statusCode).toBe(400)
    expect((await call(ana, 'POST', '/api/support/tickets', { subject: 'x', description: '' })).statusCode).toBe(400)
  })
})

describe('contul de platformă', () => {
  it('rutele de platformă nu există pentru un om obișnuit', async () => {
    const ticket = await openTicket(ana)
    expect((await call(ana, 'GET', '/api/platform/support/tickets')).statusCode).toBe(404)
    expect((await call(ana, 'GET', `/api/platform/support/tickets/${ticket.id}`)).statusCode).toBe(404)
    expect((await call(ana, 'POST', `/api/platform/support/tickets/${ticket.id}/replies`, { body: 'x' })).statusCode).toBe(404)
    expect((await call(ana, 'PATCH', `/api/platform/support/tickets/${ticket.id}`, { status: 'inchis' })).statusCode).toBe(404)
  })

  it('vede tichetele tuturor, necitite întâi, și le poate filtra pe stare', async () => {
    const alAnei = await openTicket(ana, 'Primul')
    const alLuiBogdan = await openTicket(bogdan, 'Al doilea')
    await call(platforma, 'GET', `/api/platform/support/tickets/${alLuiBogdan.id}`)

    const all = (await call(platforma, 'GET', '/api/platform/support/tickets')).json().data as Array<{ id: string; unread: boolean }>
    const ids = all.map((t) => t.id)
    expect(ids).toEqual(expect.arrayContaining([alAnei.id, alLuiBogdan.id]))
    expect(ids.indexOf(alAnei.id)).toBeLessThan(ids.indexOf(alLuiBogdan.id))
    expect(all.find((t) => t.id === alLuiBogdan.id)!.unread).toBe(false)

    await call(platforma, 'PATCH', `/api/platform/support/tickets/${alAnei.id}`, { status: 'inchis' })
    const closed = (await call(platforma, 'GET', '/api/platform/support/tickets?status=inchis')).json().data as Array<{ id: string }>
    expect(closed.map((t) => t.id)).toContain(alAnei.id)
    expect(closed.map((t) => t.id)).not.toContain(alLuiBogdan.id)
  })
})

describe('firul unui tichet', () => {
  it('tichet nou → email la platformă; răspuns → email la autor, tichet „răspuns”, necitit până îl deschide', async () => {
    const ticket = await openTicket(ana)
    expect(emailsTo(platforma)).toHaveLength(1)
    expect(emailsTo(platforma)[0]![0].text).toContain(`/platform/support/${ticket.id}`)
    expect(emailsTo(ana)).toHaveLength(0)

    const before = (await call(platforma, 'GET', '/api/support/unread')).json().data
    expect(before.platform).toBeGreaterThanOrEqual(1)

    const reply = await call(platforma, 'POST', `/api/platform/support/tickets/${ticket.id}/replies`, { body: 'Verifică dacă ai o cutie atribuită.' })
    expect(reply.statusCode).toBe(201)
    expect(reply.json().data).toMatchObject({ status: 'raspuns', replies: [{ isPlatformReply: true, author: { id: platforma.id } }] })
    expect(emailsTo(ana)).toHaveLength(1)
    expect(emailsTo(ana)[0]![0].text).toContain(`/support/${ticket.id}`)

    expect((await call(ana, 'GET', '/api/support/unread')).json().data).toEqual({ mine: 1, platform: null })
    const mine = (await call(ana, 'GET', '/api/support/tickets')).json().data as Array<{ id: string; unread: boolean }>
    expect(mine.find((t) => t.id === ticket.id)!.unread).toBe(true)

    await call(ana, 'GET', `/api/support/tickets/${ticket.id}`)
    expect((await call(ana, 'GET', '/api/support/unread')).json().data.mine).toBe(0)
  })

  it('autorul închide; un răspuns de-al lui redeschide tichetul și îl face necitit pentru platformă', async () => {
    const ticket = await openTicket(ana)
    await call(platforma, 'GET', `/api/platform/support/tickets/${ticket.id}`)

    const closed = await call(ana, 'PATCH', `/api/support/tickets/${ticket.id}`, { status: 'inchis' })
    expect(closed.json().data.status).toBe('inchis')
    expect((await call(ana, 'PATCH', `/api/support/tickets/${ticket.id}`, { status: 'deschis' })).statusCode).toBe(400)

    sendEmailMock.mockClear()
    const reply = await call(ana, 'POST', `/api/support/tickets/${ticket.id}/replies`, { body: 'Tot nu merge.' })
    expect(reply.json().data).toMatchObject({ status: 'deschis', replies: [{ isPlatformReply: false }] })
    expect(emailsTo(platforma)).toHaveLength(1)

    const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, ticket.id))
    expect(row).toMatchObject({ unreadByPlatform: true, unreadByAuthor: false })
  })

  it('un email care nu pleacă nu pierde tichetul', async () => {
    sendEmailMock.mockRejectedValueOnce(new Error('Resend jos'))
    const ticket = await openTicket(ana, 'Fără email')
    expect((await call(ana, 'GET', `/api/support/tickets/${ticket.id}`)).statusCode).toBe(200)
  })
})

describe('noutăți văzute', () => {
  it('se țin pe om și nu pot fi puse în viitor', async () => {
    expect((await call(ana, 'GET', '/api/auth/me')).json().data.updatesSeenAt).toBeNull()
    const res = await call(ana, 'PATCH', '/api/auth/me', { updatesSeenAt: '2999-01-01T00:00:00.000Z' })
    expect(res.statusCode).toBe(200)
    const seen = Date.parse(res.json().data.updatesSeenAt)
    expect(seen).toBeLessThanOrEqual(Date.now())
    expect(seen).toBeGreaterThan(Date.now() - 60_000)
    expect((await call(bogdan, 'GET', '/api/auth/me')).json().data.updatesSeenAt).toBeNull()
  })
})
