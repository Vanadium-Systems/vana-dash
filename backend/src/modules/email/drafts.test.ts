/**
 * Drafts over HTTP: the optimistic-concurrency check on PATCH, the attachment path whitelist,
 * and the per-person thread filter on the list. No Resend involved.
 */
import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { emailDrafts, emailMessages, emailThreads, roles, userMailboxes, users } from '../../shared/db/schema/index.js'

const app = await buildServer()
await app.ready()

const RUN = randomUUID().slice(0, 8)
const FEATURES = ['email.view', 'email.trimitere']
const userIds: string[] = []
const roleIds: string[] = []
const threadIds: string[] = []

async function makeToken(label: string): Promise<{ id: string; token: string }> {
  const [role] = await db.insert(roles).values({ name: `Test drafts ${label} ${RUN}`, kind: 'custom', features: FEATURES }).returning()
  roleIds.push(role!.id)
  const [row] = await db
    .insert(users)
    .values({ email: `${label}-${RUN}@example.com`, passwordHash: await argon2.hash('acme-test-password'), displayName: label, roleId: role!.id })
    .returning()
  userIds.push(row!.id)
  await db.insert(userMailboxes).values({ userId: row!.id, identityKey: 'contact' })
  return { id: row!.id, token: await app.jwt.sign({ sub: row!.id, sv: 1 }) }
}

const anna = await makeToken('anna')
const bogdan = await makeToken('bogdan')

const call = (who: { token: string }, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  app.inject({ method, url, cookies: { vana_session: who.token }, payload })

async function makeThread() {
  const subject = `Acme drafts ${RUN} ${randomUUID().slice(0, 6)}`
  const [thread] = await db
    .insert(emailThreads)
    .values({ subject, participants: ['sender@example.com', 'contact@vanadium.systems'], lastMessageAt: new Date() })
    .returning()
  threadIds.push(thread!.id)
  await db.insert(emailMessages).values({
    threadId: thread!.id,
    direction: 'in',
    fromAddress: 'sender@example.com',
    toAddress: 'contact@vanadium.systems',
    subject,
    bodyText: 'Hello from Acme',
    receivedAt: new Date(),
  })
  return thread!
}

afterAll(async () => {
  await db.delete(emailDrafts).where(inArray(emailDrafts.ownerUserId, userIds))
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

describe('PATCH /api/email/drafts/:id', () => {
  it('answers 409 DRAFT_CHANGED when expectedUpdatedAt is older than the draft', async () => {
    const created = await call(anna, 'POST', '/api/email/drafts', { fromKey: 'contact', to: 'client@example.com', subject: 'Acme', body: '<p>v1</p>' })
    expect(created.statusCode, created.body).toBe(201)
    const { id, updatedAt: firstUpdatedAt } = created.json().data

    await new Promise((resolve) => setTimeout(resolve, 10))
    const second = await call(anna, 'PATCH', `/api/email/drafts/${id}`, { body: '<p>v2</p>', expectedUpdatedAt: firstUpdatedAt })
    expect(second.statusCode, second.body).toBe(200)

    const stale = await call(anna, 'PATCH', `/api/email/drafts/${id}`, { body: '<p>v3</p>', expectedUpdatedAt: firstUpdatedAt })
    expect(stale.statusCode, stale.body).toBe(409)
    expect(stale.json().error.code).toBe('DRAFT_CHANGED')
    expect(stale.json().error.updatedAt).toBe(second.json().data.updatedAt)

    const [row] = await db.select().from(emailDrafts).where(eq(emailDrafts.id, id))
    expect(row?.body).toBe('<p>v2</p>')
  })

  it('rejects a storagePath that does not belong to the draft with 400', async () => {
    const created = await call(anna, 'POST', '/api/email/drafts', { fromKey: 'contact', to: 'client@example.com', subject: 'Acme' })
    const { id } = created.json().data

    const res = await call(anna, 'PATCH', `/api/email/drafts/${id}`, {
      attachments: [{ filename: 'secret.pdf', storagePath: `documents/other-${RUN}/secret.pdf` }],
    })
    expect(res.statusCode, res.body).toBe(400)
    const [row] = await db.select().from(emailDrafts).where(eq(emailDrafts.id, id))
    expect(row?.attachments).toEqual([])
  })

  it('accepts the storagePath the draft already holds', async () => {
    const created = await call(anna, 'POST', '/api/email/drafts', {
      fromKey: 'contact',
      to: 'client@example.com',
      subject: 'Acme',
      attachments: [{ filename: 'offer.txt', content: Buffer.from('Acme offer').toString('base64') }],
    })
    expect(created.statusCode, created.body).toBe(201)
    const [held] = created.json().data.attachments as Array<{ filename: string; storagePath: string }>

    const res = await call(anna, 'PATCH', `/api/email/drafts/${created.json().data.id}`, { attachments: [held] })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json().data.attachments).toEqual([held])
  })

  it('answers 404 for a draft of another person', async () => {
    const created = await call(anna, 'POST', '/api/email/drafts', { fromKey: 'contact', to: 'client@example.com', subject: 'Acme' })
    const res = await call(bogdan, 'PATCH', `/api/email/drafts/${created.json().data.id}`, { body: '<p>mine now</p>' })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /api/email/drafts?threadId=', () => {
  it('returns only my drafts on that thread', async () => {
    const thread = await makeThread()
    const otherThread = await makeThread()
    const reply = (who: { token: string }, threadId: string) =>
      call(who, 'POST', '/api/email/drafts', { fromKey: 'contact', mode: 'reply', threadId, body: '<p>reply</p>' })

    const mine = (await reply(anna, thread.id)).json().data.id
    const mineOnOtherThread = (await reply(anna, otherThread.id)).json().data.id
    const theirs = (await reply(bogdan, thread.id)).json().data.id
    expect([mine, mineOnOtherThread, theirs].every(Boolean)).toBe(true)

    const res = await call(anna, 'GET', `/api/email/drafts?threadId=${thread.id}`)
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json().data.map((d: { id: string }) => d.id)).toEqual([mine])

    const all = await call(anna, 'GET', '/api/email/drafts')
    const ids = all.json().data.map((d: { id: string }) => d.id)
    expect(ids).toContain(mineOnOtherThread)
    expect(ids).not.toContain(theirs)
  })
})
