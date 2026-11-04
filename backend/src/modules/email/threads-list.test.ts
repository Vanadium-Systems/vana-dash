/**
 * Thread list rows (snippet, attachment chips, filters), the search suggestions and the
 * attachments zip. Mailbox visibility is checked on the suggestions and the zip, the two paths
 * that read across threads and messages.
 */
import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { unzipSync } from 'fflate'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import { emailAttachments, emailMessages, emailThreadReads, emailThreads, roles, users } from '../../shared/db/schema/index.js'
import { effectiveFeatures, type SessionUser } from '../../shared/lib/session.js'
import { buildMessageAttachmentsZip } from './attachments-zip.js'
import { listThreads, suggestSearch } from './inbound-service.js'
import { markThreadRead } from './mailboxes.js'

// readDocument is only replaced inside the zip tests, to avoid writing 100 MB to disk.
const storage = vi.hoisted(() => ({ read: null as null | ((path: string) => Promise<Buffer>) }))
vi.mock('../../shared/lib/storage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/lib/storage.js')>()
  return { ...actual, readDocument: (path: string) => (storage.read ? storage.read(path) : actual.readDocument(path)) }
})

const RUN = randomUUID().slice(0, 8)
const FEATURES = ['email.view']
const threadIds: string[] = []

const [role] = await db.insert(roles).values({ name: `Test threads list ${RUN}`, kind: 'custom', features: FEATURES }).returning()
const [userRow] = await db
  .insert(users)
  .values({ email: `anna-${RUN}@example.com`, passwordHash: await argon2.hash('acme-test-password'), displayName: 'anna', roleId: role!.id })
  .returning()

function personWith(mailboxes: string[] | null): SessionUser {
  return {
    id: userRow!.id,
    email: userRow!.email,
    displayName: 'anna',
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
}

// null = every mailbox, so the list shows exactly what the filters select.
const everything = personWith(null)

async function makeThread(opts: {
  from: string
  to?: string
  subject?: string
  bodyText?: string
  lastMessageAt?: Date
  attachments?: Array<{ filename: string; disposition?: 'inline' | 'attachment' | null; storagePath?: string }>
}) {
  const subject = opts.subject ?? `Acme list ${RUN} ${randomUUID().slice(0, 6)}`
  const [thread] = await db
    .insert(emailThreads)
    .values({ subject, participants: [opts.from, opts.to ?? 'contact@vanadium.systems'], lastMessageAt: opts.lastMessageAt ?? new Date() })
    .returning()
  threadIds.push(thread!.id)
  const [message] = await db
    .insert(emailMessages)
    .values({
      threadId: thread!.id,
      direction: 'in',
      fromAddress: opts.from,
      toAddress: opts.to ?? 'contact@vanadium.systems',
      subject,
      bodyText: opts.bodyText ?? 'Hello from Acme',
      receivedAt: opts.lastMessageAt ?? new Date(),
    })
    .returning()
  for (const [i, att] of (opts.attachments ?? []).entries()) {
    await db.insert(emailAttachments).values({
      messageId: message!.id,
      filename: att.filename,
      storagePath: att.storagePath ?? `email-attachments/acme-${RUN}/${i}`,
      contentType: 'application/octet-stream',
      disposition: att.disposition ?? null,
    })
  }
  return { thread: thread!, message: message! }
}

afterEach(() => {
  storage.read = null
})

afterAll(async () => {
  await db.delete(emailThreadReads).where(eq(emailThreadReads.userId, userRow!.id))
  if (threadIds.length) {
    await db.delete(emailMessages).where(inArray(emailMessages.threadId, threadIds))
    await db.delete(emailThreads).where(inArray(emailThreads.id, threadIds))
  }
  await db.delete(users).where(eq(users.id, userRow!.id))
  await db.delete(roles).where(eq(roles.id, role!.id))
})

describe('listThreads: snippet and attachment chips', () => {
  it('collapses whitespace in the snippet and cuts it at 140 characters', async () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join('  \n\n\t ')
    const { thread } = await makeThread({ from: `snippet-${RUN}@example.com`, bodyText: `  ${words}  ` })

    const [row] = (await listThreads(everything, { from: `snippet-${RUN}`, limit: 10 })).filter((t) => t.id === thread.id)

    expect(row!.snippet.length).toBeLessThanOrEqual(140)
    expect(row!.snippet.length).toBeGreaterThan(100)
    expect(row!.snippet).not.toMatch(/\s{2}|[\n\t]/)
    expect(row!.snippet.startsWith('word0 word1 word2')).toBe(true)
  })

  it('keeps a short body whole, with whitespace collapsed', async () => {
    const { thread } = await makeThread({ from: `short-${RUN}@example.com`, bodyText: 'Hi   there,\n\nAcme   team' })
    const [row] = (await listThreads(everything, { from: `short-${RUN}`, limit: 10 })).filter((t) => t.id === thread.id)
    expect(row!.snippet).toBe('Hi there, Acme team')
  })

  it('returns at most 3 attachment chips and leaves inline images out', async () => {
    const { thread } = await makeThread({
      from: `chips-${RUN}@example.com`,
      attachments: [
        { filename: 'logo.png', disposition: 'inline' },
        { filename: 'a.pdf', disposition: 'attachment' },
        { filename: 'b.pdf', disposition: null },
        { filename: 'c.pdf', disposition: 'attachment' },
        { filename: 'd.pdf', disposition: 'attachment' },
      ],
    })
    const [row] = (await listThreads(everything, { from: `chips-${RUN}`, limit: 10 })).filter((t) => t.id === thread.id)

    expect(row!.attachments).toHaveLength(3)
    expect(row!.attachments.map((a) => a.filename)).not.toContain('logo.png')
    expect(row!.attachmentNames).toHaveLength(4)
    expect(row!.hasAttachment).toBe(true)
  })

  it('a thread with only an inline image has no chips and no paperclip', async () => {
    const { thread } = await makeThread({ from: `inline-${RUN}@example.com`, attachments: [{ filename: 'logo.png', disposition: 'inline' }] })
    const [row] = (await listThreads(everything, { from: `inline-${RUN}`, limit: 10 })).filter((t) => t.id === thread.id)
    expect(row!.attachments).toEqual([])
    expect(row!.hasAttachment).toBe(false)
  })
})

describe('listThreads: filters', () => {
  it('from, unread and after narrow the list', async () => {
    const fresh = await makeThread({ from: `fresh-${RUN}@example.com`, lastMessageAt: new Date() })
    const old = await makeThread({ from: `old-${RUN}@example.com`, lastMessageAt: new Date('2020-01-01T00:00:00Z') })
    const readOne = await makeThread({ from: `read-${RUN}@example.com`, lastMessageAt: new Date() })
    await markThreadRead(everything, readOne.thread.id, new Date(Date.now() + 60_000))
    const ids = async (query: Parameters<typeof listThreads>[1]) =>
      (await listThreads(everything, { limit: 200, ...query })).map((t) => t.id)

    // `from`: only the sender asked for.
    expect(await ids({ from: `fresh-${RUN}` })).toEqual([fresh.thread.id])

    // `unread`: the thread the person already read drops out.
    const unread = await ids({ from: RUN, unread: true })
    expect(unread).toContain(fresh.thread.id)
    expect(unread).toContain(old.thread.id)
    expect(unread).not.toContain(readOne.thread.id)

    // `after`: the old thread is before the date.
    const recent = await ids({ from: RUN, after: '2024-01-01T00:00:00.000Z' })
    expect(recent).toContain(fresh.thread.id)
    expect(recent).not.toContain(old.thread.id)

    // `before` is the mirror image.
    const older = await ids({ from: RUN, before: '2024-01-01T00:00:00.000Z' })
    expect(older).toEqual([old.thread.id])

    // All of them together.
    const combined = await ids({ from: RUN, unread: true, after: '2024-01-01T00:00:00.000Z' })
    expect(combined).toContain(fresh.thread.id)
    expect(combined).not.toContain(old.thread.id)
    expect(combined).not.toContain(readOne.thread.id)
  })
})

describe('suggestSearch', () => {
  it('never returns a thread or an address from a mailbox the person cannot see', async () => {
    // A token only these two threads carry, so the 5-row limit cannot push them out.
    const token = `sug${RUN}`
    const hiddenFrom = `hidden-${token}@example.com`
    const visibleFrom = `visible-${token}@example.com`
    const visible = await makeThread({ from: visibleFrom, to: 'contact@vanadium.systems', subject: `Acme visible ${token}` })
    const hidden = await makeThread({ from: hiddenFrom, to: 'stefan@vanadium.systems', subject: `Acme hidden ${token}` })

    const contactOnly = await suggestSearch(personWith(['contact']), token)
    const threadsSeen = contactOnly.threads.map((t) => t.id)
    expect(threadsSeen).toContain(visible.thread.id)
    expect(threadsSeen).not.toContain(hidden.thread.id)
    expect(contactOnly.addresses).toContain(visibleFrom)
    expect(contactOnly.addresses).not.toContain(hiddenFrom)

    // Control: with every mailbox the hidden thread does match, so the filter is what hid it.
    const all = await suggestSearch(everything, token)
    expect(all.threads.map((t) => t.id)).toContain(hidden.thread.id)

    // A person with no mailbox sees nothing.
    expect((await suggestSearch(personWith([]), token)).threads).toEqual([])
  })
})

describe('buildMessageAttachmentsZip', () => {
  it('zips the visible attachments, numbering duplicate names', async () => {
    const { message } = await makeThread({
      from: `zip-${RUN}@example.com`,
      subject: `Acme zip ${RUN}`,
      attachments: [
        { filename: 'offer.txt', storagePath: `acme-${RUN}/1` },
        { filename: 'offer.txt', storagePath: `acme-${RUN}/2` },
        { filename: 'logo.png', disposition: 'inline', storagePath: `acme-${RUN}/3` },
      ],
    })
    storage.read = async (path) => Buffer.from(`content of ${path}`)

    const result = await buildMessageAttachmentsZip(personWith(['contact']), message.id)

    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.fileName).toBe(`Acme zip ${RUN}.zip`)
    const files = unzipSync(new Uint8Array(result.buffer))
    expect(Object.keys(files).sort()).toEqual(['offer (2).txt', 'offer.txt'])
  })

  it("answers 'too-large' when the files add up past the cap", async () => {
    const { message } = await makeThread({
      from: `big-${RUN}@example.com`,
      attachments: [
        { filename: 'one.bin', storagePath: `acme-${RUN}/big1` },
        { filename: 'two.bin', storagePath: `acme-${RUN}/big2` },
      ],
    })
    const big = Buffer.alloc(60 * 1024 * 1024)
    storage.read = async () => big

    expect((await buildMessageAttachmentsZip(personWith(['contact']), message.id)).kind).toBe('too-large')
  })

  it("answers 'not-found' for a message on a mailbox the person cannot see", async () => {
    const { message } = await makeThread({
      from: `other-${RUN}@example.com`,
      to: 'stefan@vanadium.systems',
      attachments: [{ filename: 'offer.txt', storagePath: `acme-${RUN}/hidden` }],
    })
    storage.read = async () => Buffer.from('secret')

    expect(await buildMessageAttachmentsZip(personWith(['contact']), message.id)).toEqual({ kind: 'not-found' })
    expect((await buildMessageAttachmentsZip(everything, message.id)).kind).toBe('ok')
  })

  it("answers 'not-found' when the message has only inline images", async () => {
    const { message } = await makeThread({ from: `inl-${RUN}@example.com`, attachments: [{ filename: 'logo.png', disposition: 'inline' }] })
    expect(await buildMessageAttachmentsZip(everything, message.id)).toEqual({ kind: 'not-found' })
  })
})
