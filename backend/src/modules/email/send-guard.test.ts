/**
 * The delivery gate (send-guard.ts) on the four ways a person sends and over HTTP: unsubscribed
 * recipients are refused before anything is written or sent, the outreach identity takes one
 * recipient and obeys the company cap and the lower cap of a person. Resend is mocked; the
 * identity `outreach` is pointed at an invented address so the daily count is ours alone.
 */
import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import {
  dashboardConfig,
  emailDrafts,
  emailMessages,
  emailSends,
  emailSuppressions,
  emailThreads,
  emailUserSettings,
  roles,
  userMailboxes,
  users,
} from '../../shared/db/schema/index.js'
import type { SendEmailResult } from '../../shared/lib/email.js'
import { effectiveFeatures, type SessionUser } from '../../shared/lib/session.js'
import { sendDraft, sendForward, sendNew, sendReply } from './scheduled-send.js'
import { EmailSuppressedError, OutreachCapError } from './send-guard.js'
import { getIdentities, updateEmailSettings } from './settings-service.js'

type SendOpts = Parameters<typeof import('../../shared/lib/email.js').sendEmailWithResult>[0]
const mocks = vi.hoisted(() => ({ sendEmailWithResult: vi.fn<(opts: SendOpts) => Promise<SendEmailResult>>() }))
vi.mock('../../shared/lib/email.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/lib/email.js')>()
  return { ...actual, sendEmailWithResult: mocks.sendEmailWithResult, fetchReceivedEmail: async () => null }
})

const app = await buildServer()
await app.ready()

const RUN = randomUUID().slice(0, 8)
const OUTREACH_FROM = 'Acme Outreach <outreach@example.com>'
const CONFIG_KEYS = ['email.identities', 'email.outreach_daily_cap']
const FEATURES = ['email.view', 'email.trimitere']

const userIds: string[] = []
const roleIds: string[] = []
const threadIds: string[] = []
const suppressed: string[] = []
let savedConfig: Array<{ key: string; value: unknown }> = []

interface TestPerson {
  me: SessionUser
  token: string
}

async function makePerson(label: string): Promise<TestPerson> {
  const email = `${label}-${RUN}@example.com`
  const mailboxes = ['contact', 'outreach']
  const [role] = await db.insert(roles).values({ name: `Test guard ${label} ${RUN}`, kind: 'custom', features: FEATURES }).returning()
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

async function suppress(prefix: string): Promise<string> {
  const email = `${prefix}-${RUN}@example.com`.toLowerCase()
  suppressed.push(email)
  await db.insert(emailSuppressions).values({ email })
  return email
}

async function makeInboundThread(from: string) {
  const subject = `Acme guard ${RUN} ${randomUUID().slice(0, 6)}`
  const [thread] = await db
    .insert(emailThreads)
    .values({ subject, participants: [from, 'contact@vanadium.systems'], lastMessageAt: new Date() })
    .returning()
  threadIds.push(thread!.id)
  const [message] = await db
    .insert(emailMessages)
    .values({
      threadId: thread!.id,
      direction: 'in',
      fromAddress: from,
      toAddress: 'contact@vanadium.systems',
      subject,
      bodyText: 'Hello from Acme',
      receivedAt: new Date(),
    })
    .returning()
  return { thread: thread!, message: message! }
}

beforeAll(async () => {
  savedConfig = (await db.select({ key: dashboardConfig.key, value: dashboardConfig.value }).from(dashboardConfig).where(inArray(dashboardConfig.key, CONFIG_KEYS)))
  const identities = await getIdentities()
  await updateEmailSettings({
    identities: [...identities.filter((i) => i.key !== 'outreach'), { key: 'outreach', label: 'Outreach', fromAddress: OUTREACH_FROM }],
    outreachDailyCap: 50,
  })
})

beforeEach(() => {
  mocks.sendEmailWithResult.mockReset()
  mocks.sendEmailWithResult.mockImplementation(async () => ({ ok: true, id: `acme-${randomUUID()}` }))
})

afterEach(async () => {
  await db.delete(emailSends).where(inArray(emailSends.sentByUserId, userIds))
  await db.delete(emailDrafts).where(inArray(emailDrafts.ownerUserId, userIds))
  await db.delete(emailUserSettings).where(inArray(emailUserSettings.userId, userIds))
})

afterAll(async () => {
  await db.delete(dashboardConfig).where(inArray(dashboardConfig.key, CONFIG_KEYS))
  if (savedConfig.length) await db.insert(dashboardConfig).values(savedConfig)
  if (suppressed.length) await db.delete(emailSuppressions).where(inArray(emailSuppressions.email, suppressed))
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

describe('unsubscribed recipient', () => {
  it.each(['sendNew', 'sendReply', 'sendForward', 'sendDraft'] as const)('%s is refused with EmailSuppressedError and Resend is not called', async (path) => {
    const blocked = await suppress(`blocked-${path}`)
    const { thread, message } = await makeInboundThread(blocked)

    const attempt = {
      // A reply with no explicit recipient answers the sender of the last inbound message.
      sendReply: () => sendReply(anna.me, thread.id, { body: '<p>Hello</p>' }),
      sendNew: () => sendNew(anna.me, { to: [blocked], cc: [], subject: 'Acme hello', body: '<p>Hello</p>', from: 'contact' }),
      sendForward: () => sendForward(anna.me, message.id, { to: [blocked], cc: [], includeOriginalAttachments: false }),
      sendDraft: async () => {
        const [draft] = await db
          .insert(emailDrafts)
          .values({ ownerUserId: anna.me.id, fromKey: 'contact', to: blocked, subject: 'Acme hello', body: '<p>Hello</p>', mode: 'new' })
          .returning()
        return sendDraft(anna.me, draft!.id)
      },
    }[path]

    await expect(attempt()).rejects.toBeInstanceOf(EmailSuppressedError)
    expect(mocks.sendEmailWithResult).not.toHaveBeenCalled()
    expect(await db.select().from(emailSends).where(eq(emailSends.sentByUserId, anna.me.id))).toHaveLength(0)
  })

  it('refuses a suppressed address in Cc, whatever its casing', async () => {
    const blocked = await suppress('blocked-cc')
    await expect(
      sendNew(anna.me, { to: [`fine-${RUN}@example.com`], cc: [blocked.toUpperCase()], subject: 'Acme hello', body: '<p>Hello</p>', from: 'contact' }),
    ).rejects.toBeInstanceOf(EmailSuppressedError)
    expect(mocks.sendEmailWithResult).not.toHaveBeenCalled()
  })

  it('POST /api/email/send answers 409 RECIPIENT_UNSUBSCRIBED', async () => {
    const blocked = await suppress('blocked-http')
    const res = await app.inject({
      method: 'POST',
      url: '/api/email/send',
      cookies: { vana_session: anna.token },
      payload: { to: blocked, subject: 'Acme hello', body: '<p>Hello</p>', from: 'contact' },
    })
    expect(res.statusCode, res.body).toBe(409)
    expect(res.json().error.code).toBe('RECIPIENT_UNSUBSCRIBED')
    expect(mocks.sendEmailWithResult).not.toHaveBeenCalled()
  })
})

describe('outreach identity', () => {
  const outreach = (to: string[], cc: string[] = []) => ({ to, cc, subject: 'Acme intro', body: '<p>Hello</p>', from: 'outreach' })

  it('refuses two recipients (to + cc) over HTTP with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/email/send',
      cookies: { vana_session: anna.token },
      payload: { to: [`one-${RUN}@example.com`], cc: [`two-${RUN}@example.com`], subject: 'Acme intro', body: '<p>Hello</p>', from: 'outreach' },
    })
    expect(res.statusCode, res.body).toBe(400)
    expect(mocks.sendEmailWithResult).not.toHaveBeenCalled()
    expect(await db.select().from(emailSends).where(eq(emailSends.sentByUserId, anna.me.id))).toHaveLength(0)
  })

  it('accepts a single recipient', async () => {
    const { sendId } = await sendNew(anna.me, outreach([`one-${RUN}@example.com`]))
    expect(sendId).toBeTruthy()
  })

  it('stops a person at their own cap while another person can still send', async () => {
    await updateEmailSettings({ outreachDailyCap: 5 })
    await db.insert(emailUserSettings).values({ userId: anna.me.id, outreachDailyCap: 1 })

    await sendNew(anna.me, outreach([`first-${RUN}@example.com`]))
    const refused = sendNew(anna.me, outreach([`second-${RUN}@example.com`]))
    await expect(refused).rejects.toBeInstanceOf(OutreachCapError)
    await expect(refused).rejects.toMatchObject({ limit: 1 })

    await expect(sendNew(bogdan.me, outreach([`third-${RUN}@example.com`]))).resolves.toHaveProperty('sendId')
  })

  it('applies the company cap to the total of all people', async () => {
    await updateEmailSettings({ outreachDailyCap: 2 })

    await sendNew(anna.me, outreach([`a-${RUN}@example.com`]))
    await sendNew(bogdan.me, outreach([`b-${RUN}@example.com`]))
    const refused = sendNew(bogdan.me, outreach([`c-${RUN}@example.com`]))
    await expect(refused).rejects.toBeInstanceOf(OutreachCapError)
    await expect(refused).rejects.toMatchObject({ limit: 2 })
  })

  it('a cancelled send gives its slot back', async () => {
    await updateEmailSettings({ outreachDailyCap: 1 })
    const { sendId } = await sendNew(anna.me, outreach([`a-${RUN}@example.com`]))
    await db.update(emailSends).set({ status: 'cancelled' }).where(eq(emailSends.id, sendId))
    await expect(sendNew(anna.me, outreach([`b-${RUN}@example.com`]))).resolves.toHaveProperty('sendId')
  })

  it('HTTP: the cap answers 429 OUTREACH_CAP_REACHED with the limit', async () => {
    await updateEmailSettings({ outreachDailyCap: 5 })
    await db.insert(emailUserSettings).values({ userId: anna.me.id, outreachDailyCap: 0 })
    const res = await app.inject({
      method: 'POST',
      url: '/api/email/send',
      cookies: { vana_session: anna.token },
      payload: { to: `a-${RUN}@example.com`, subject: 'Acme intro', body: '<p>Hello</p>', from: 'outreach' },
    })
    expect(res.statusCode, res.body).toBe(429)
    expect(res.json().error).toMatchObject({ code: 'OUTREACH_CAP_REACHED', limit: 0 })
  })
})
