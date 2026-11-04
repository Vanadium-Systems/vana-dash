/**
 * Delayed send (scheduled-send.ts): a send waits in email_sends as 'scheduled', Undo turns it
 * back into a draft, and dispatchScheduledSend / dispatchOverdueSends are the only things that
 * reach Resend. Resend is mocked; rows are made due by hand instead of waiting out the undo window.
 */
import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { and, eq, inArray, like, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { emailDrafts, emailMessages, emailSends, emailThreads, roles, userMailboxes, users } from '../../shared/db/schema/index.js'
import type { SendEmailResult } from '../../shared/lib/email.js'
import { effectiveFeatures, type SessionUser } from '../../shared/lib/session.js'
import { cancelScheduledSend, dispatchOverdueSends, dispatchScheduledSend, SendAlreadyDispatched, sendNew, sendReply, UNDO_WINDOW_MS } from './scheduled-send.js'

type SendOpts = Parameters<typeof import('../../shared/lib/email.js').sendEmailWithResult>[0]
const mocks = vi.hoisted(() => ({ sendEmailWithResult: vi.fn<(opts: SendOpts) => Promise<SendEmailResult>>() }))
vi.mock('../../shared/lib/email.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/lib/email.js')>()
  return { ...actual, sendEmailWithResult: mocks.sendEmailWithResult, fetchReceivedEmail: async () => null }
})

const app = await buildServer()
await app.ready()

const RUN = randomUUID().slice(0, 8)
const SUBJECT_PREFIX = `Acme scheduled ${RUN}`
const FEATURES = ['email.view', 'email.trimitere']

const userIds: string[] = []
const roleIds: string[] = []

interface TestPerson {
  me: SessionUser
  token: string
}

async function makePerson(label: string): Promise<TestPerson> {
  const email = `${label}-${RUN}@example.com`
  const mailboxes = ['contact']
  const [role] = await db.insert(roles).values({ name: `Test scheduled ${label} ${RUN}`, kind: 'custom', features: FEATURES }).returning()
  roleIds.push(role!.id)
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: await argon2.hash('acme-test-password'), displayName: label, roleId: role!.id })
    .returning()
  userIds.push(row!.id)
  await db.insert(userMailboxes).values(mailboxes.map((identityKey) => ({ userId: row!.id, identityKey })))
  const me: SessionUser = {
    id: row!.id,
    email,
    displayName: label,
    role: { id: role!.id, name: role!.name, kind: 'custom' },
    isPlatformAdmin: false,
    features: effectiveFeatures(FEATURES, 'custom'),
    mailboxes,
    status: 'active',
    lastSeenAt: null,
    notificationPrefs: null,
    navLayout: null,
    updatesSeenAt: null,
    locale: 'ro',
    displayCurrency: 'RON',
    sessionVersion: 1,
  }
  return { me, token: await app.jwt.sign({ sub: row!.id, sv: 1 }) }
}

const anna = await makePerson('anna')
const bogdan = await makePerson('bogdan')

const newMessage = (extra: Partial<Parameters<typeof sendNew>[1]> = {}) => ({
  to: [`client-${randomUUID().slice(0, 6)}@example.com`],
  cc: [] as string[],
  subject: `${SUBJECT_PREFIX} ${randomUUID().slice(0, 6)}`,
  body: '<p>Hello from <b>Acme</b></p>',
  from: 'contact',
  ...extra,
})

async function makeDue(sendId: string) {
  await db
    .update(emailSends)
    .set({ sendAfter: sql`now() - interval '1 second'` })
    .where(eq(emailSends.id, sendId))
}

async function getSend(sendId: string) {
  const [row] = await db.select().from(emailSends).where(eq(emailSends.id, sendId))
  return row!
}

beforeEach(() => {
  mocks.sendEmailWithResult.mockReset()
  mocks.sendEmailWithResult.mockImplementation(async () => ({ ok: true, id: `acme-${randomUUID()}` }))
})

afterEach(async () => {
  await db.delete(emailSends).where(inArray(emailSends.sentByUserId, userIds))
  await db.delete(emailDrafts).where(inArray(emailDrafts.ownerUserId, userIds))
})

afterAll(async () => {
  const threads = await db.select({ id: emailThreads.id }).from(emailThreads).where(like(emailThreads.subject, `%${SUBJECT_PREFIX}%`))
  const threadIds = threads.map((t) => t.id)
  if (threadIds.length) {
    await db.delete(emailMessages).where(inArray(emailMessages.threadId, threadIds))
    await db.delete(emailThreads).where(inArray(emailThreads.id, threadIds))
  }
  for (const id of userIds) {
    await db.delete(userMailboxes).where(eq(userMailboxes.userId, id))
    await db.delete(users).where(eq(users.id, id))
  }
  if (roleIds.length) await db.delete(roles).where(inArray(roles.id, roleIds))
  await app.close()
})

describe('scheduling', () => {
  it('writes a scheduled row inside the undo window and does not touch Resend', async () => {
    const before = Date.now()
    const { sendId, sendAfter } = await sendNew(anna.me, newMessage())

    const row = await getSend(sendId)
    expect(row.status).toBe('scheduled')
    expect(row.kind).toBe('single')
    expect(sendAfter.getTime()).toBeGreaterThanOrEqual(before + UNDO_WINDOW_MS - 1000)
    expect(sendAfter.getTime()).toBeLessThanOrEqual(Date.now() + UNDO_WINDOW_MS)
    expect(mocks.sendEmailWithResult).not.toHaveBeenCalled()
  })

  it('dispatching before the window is over is skipped', async () => {
    const { sendId } = await sendNew(anna.me, newMessage())
    expect(await dispatchScheduledSend(sendId)).toBe('skipped')
    expect(mocks.sendEmailWithResult).not.toHaveBeenCalled()
    expect((await getSend(sendId)).status).toBe('scheduled')
  })
})

describe('dispatch', () => {
  it('sends once, with the row id as idempotency key, and marks the row sent', async () => {
    const input = newMessage({ cc: [`cc-${RUN}@example.com`] })
    const { sendId } = await sendNew(anna.me, input)
    await makeDue(sendId)

    expect(await dispatchScheduledSend(sendId)).toBe('sent')

    expect(mocks.sendEmailWithResult).toHaveBeenCalledTimes(1)
    const opts = mocks.sendEmailWithResult.mock.calls[0]![0]
    expect(opts.idempotencyKey).toBe(sendId)
    expect(opts.to).toEqual(input.to)
    expect(opts.cc).toEqual(input.cc)
    const row = await getSend(sendId)
    expect(row.status).toBe('sent')
    expect(row.resendEmailId).toMatch(/^acme-/)
    expect(row.errorMessage).toBeNull()
  })

  it('two concurrent dispatches of the same row send exactly once', async () => {
    const { sendId } = await sendNew(anna.me, newMessage())
    await makeDue(sendId)

    const results = await Promise.all([dispatchScheduledSend(sendId), dispatchScheduledSend(sendId)])

    expect([...results].sort()).toEqual(['sent', 'skipped'])
    expect(mocks.sendEmailWithResult).toHaveBeenCalledTimes(1)
    expect(mocks.sendEmailWithResult.mock.calls[0]![0].idempotencyKey).toBe(sendId)
  })

  it('a draft the send came from is deleted once the email left', async () => {
    const [draft] = await db
      .insert(emailDrafts)
      .values({ ownerUserId: anna.me.id, fromKey: 'contact', to: 'client@example.com', subject: 'Acme draft', body: '<p>x</p>', mode: 'new' })
      .returning()
    const { sendId } = await sendNew(anna.me, newMessage({ draftId: draft!.id }))
    await makeDue(sendId)
    await dispatchScheduledSend(sendId)
    expect(await db.select().from(emailDrafts).where(eq(emailDrafts.id, draft!.id))).toHaveLength(0)
  })

  it('a reply carries the threading headers and is recorded on its thread', async () => {
    const subject = `${SUBJECT_PREFIX} thread ${randomUUID().slice(0, 6)}`
    const [thread] = await db
      .insert(emailThreads)
      .values({ subject, participants: ['sender@example.com', 'contact@vanadium.systems'], lastMessageAt: new Date() })
      .returning()
    const sourceMessageId = `<acme-${randomUUID()}@example.com>`
    await db.insert(emailMessages).values({
      threadId: thread!.id,
      direction: 'in',
      fromAddress: 'sender@example.com',
      toAddress: 'contact@vanadium.systems',
      subject,
      bodyText: 'Question from Acme',
      receivedAt: new Date(),
      sourceMessageId,
    })

    const { sendId } = await sendReply(anna.me, thread!.id, { body: '<p>Answer</p>' })
    await makeDue(sendId)
    expect(await dispatchScheduledSend(sendId)).toBe('sent')

    const opts = mocks.sendEmailWithResult.mock.calls[0]![0]
    expect(opts.headers?.['In-Reply-To']).toBe(sourceMessageId)
    expect(opts.to).toEqual(['sender@example.com'])
    const out = await db
      .select()
      .from(emailMessages)
      .where(and(eq(emailMessages.threadId, thread!.id), eq(emailMessages.direction, 'out')))
    expect(out).toHaveLength(1)
    expect(out[0]!.bodyHtml).toBe('<p>Answer</p>')
  })

  it('a failed Resend call marks the row failed and keeps the message as a draft', async () => {
    mocks.sendEmailWithResult.mockResolvedValue({ ok: false, error: 'Acme relay down' })
    const input = newMessage()
    const { sendId } = await sendNew(anna.me, input)
    await makeDue(sendId)

    expect(await dispatchScheduledSend(sendId)).toBe('failed')

    const row = await getSend(sendId)
    expect(row.status).toBe('failed')
    expect(row.errorMessage).toBe('Acme relay down')
    const draftId = (row.payload as { draftId?: string }).draftId
    expect(draftId).toBeTruthy()
    const [draft] = await db.select().from(emailDrafts).where(eq(emailDrafts.id, draftId!))
    expect(draft?.ownerUserId).toBe(anna.me.id)
    expect(draft?.body).toBe(input.body)
    expect(draft?.to).toBe(input.to[0])

    const status = await app.inject({ method: 'GET', url: `/api/email/sends/${sendId}/status`, cookies: { vana_session: anna.token } })
    expect(status.json().data).toMatchObject({ status: 'failed', draftId })
  })

  it('a row whose timer died with a restart is sent by dispatchOverdueSends', async () => {
    const sendId = randomUUID()
    const to = `restart-${RUN}@example.com`
    await db.insert(emailSends).values({
      id: sendId,
      recipient: to,
      fromAddress: 'Vanadium Systems <contact@vanadium.systems>',
      subject: `${SUBJECT_PREFIX} restart`,
      bodyText: 'Hello',
      bodyHtml: '<p>Hello</p>',
      status: 'scheduled',
      sentByUserId: anna.me.id,
      kind: 'single',
      sendAfter: new Date(Date.now() - 2 * 60_000),
      payload: { mode: 'new', fromKey: 'contact', to: [to], cc: [], body: '<p>Hello</p>', attachments: [] },
    })

    expect(await dispatchOverdueSends()).toBeGreaterThanOrEqual(1)

    expect((await getSend(sendId)).status).toBe('sent')
    const call = mocks.sendEmailWithResult.mock.calls.find(([opts]) => opts.idempotencyKey === sendId)
    expect(call?.[0].to).toEqual([to])
  })
})

describe('undo', () => {
  it('cancels inside the window and hands back a draft with the same recipients and body', async () => {
    const input = newMessage({ cc: [`cc-${RUN}@example.com`] })
    const { sendId } = await sendNew(anna.me, input)

    const result = await cancelScheduledSend(anna.me, sendId)

    expect((await getSend(sendId)).status).toBe('cancelled')
    const [draft] = await db.select().from(emailDrafts).where(eq(emailDrafts.id, result!.draftId))
    expect(draft).toMatchObject({ ownerUserId: anna.me.id, to: input.to[0], cc: input.cc[0], body: input.body, subject: input.subject, fromKey: 'contact' })

    // Even once due, a cancelled row never goes out.
    await makeDue(sendId)
    expect(await dispatchScheduledSend(sendId)).toBe('skipped')
    expect(mocks.sendEmailWithResult).not.toHaveBeenCalled()
  })

  it('another person cannot cancel it (null, so 404)', async () => {
    const { sendId } = await sendNew(anna.me, newMessage())
    expect(await cancelScheduledSend(bogdan.me, sendId)).toBeNull()
    expect((await getSend(sendId)).status).toBe('scheduled')
  })

  it('after dispatch it throws SendAlreadyDispatched', async () => {
    const { sendId } = await sendNew(anna.me, newMessage())
    await makeDue(sendId)
    await dispatchScheduledSend(sendId)
    await expect(cancelScheduledSend(anna.me, sendId)).rejects.toBeInstanceOf(SendAlreadyDispatched)
  })

  it('DELETE /api/email/sends/:id/scheduled: 200 with a draftId, 404 for another person, 409 after dispatch', async () => {
    const first = await sendNew(anna.me, newMessage())
    const stranger = await app.inject({ method: 'DELETE', url: `/api/email/sends/${first.sendId}/scheduled`, cookies: { vana_session: bogdan.token } })
    expect(stranger.statusCode, stranger.body).toBe(404)

    const own = await app.inject({ method: 'DELETE', url: `/api/email/sends/${first.sendId}/scheduled`, cookies: { vana_session: anna.token } })
    expect(own.statusCode, own.body).toBe(200)
    expect(own.json().data.draftId).toBeTruthy()

    const second = await sendNew(anna.me, newMessage())
    await makeDue(second.sendId)
    await dispatchScheduledSend(second.sendId)
    const late = await app.inject({ method: 'DELETE', url: `/api/email/sends/${second.sendId}/scheduled`, cookies: { vana_session: anna.token } })
    expect(late.statusCode, late.body).toBe(409)
    expect(late.json().error.code).toBe('SEND_ALREADY_DISPATCHED')
  })
})
