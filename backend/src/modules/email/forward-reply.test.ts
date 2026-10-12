/**
 * forwardMessage / replyToThread — verifică split-ul text/html introdus 2026-08-11 (editorul
 * rich-text trimite HTML acum, nu mai text simplu wrapped prin textToHtmlParagraph). Fără
 * acoperire anterioară pentru aceste 2 funcții (nici la nivel de rută) — adăugată aici, nu doar
 * ca side-effect al schimbării, ca regresiile viitoare să fie prinse.
 */
import { randomUUID } from 'node:crypto'
import { eq, inArray, like } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import { emailMessages, emailSends, emailThreads, roles, users } from '../../shared/db/schema/index.js'
import type { EmailAttachment, SendEmailResult } from '../../shared/lib/email.js'
import { saveDocument } from '../../shared/lib/storage.js'
import { emailImageStoragePath } from './images-service.js'

const sendEmailWithResultMock =
  vi.fn<(opts: { to: string; text: string; html: string; attachments?: EmailAttachment[] }) => Promise<SendEmailResult>>()
vi.mock('../../shared/lib/email.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/lib/email.js')>()
  return { ...actual, sendEmailWithResult: sendEmailWithResultMock, fetchReceivedEmail: async () => null }
})

const { forwardMessage, replyToThread } = await import('./inbound-service.js')
const { effectiveFeatures } = await import('../../shared/lib/session.js')
import type { SessionUser } from '../../shared/lib/session.js'

// Admin de test: toate cutiile (mailboxes null) și toate funcționalitățile. Se folosește doar
// ca omul din sesiune; conținutul rămâne subiectul testului.
const admin = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'stefan@vanadium.systems',
  displayName: 'Stefan',
  role: { id: '00000000-0000-4000-8000-000000000002', name: 'Admin', kind: 'admin' },
  isPlatformAdmin: true,
  features: effectiveFeatures([], 'admin'),
  mailboxes: null,
  status: 'active',
  lastSeenAt: null,
  notificationPrefs: null,
  navLayout: null,
  updatesSeenAt: null,
  locale: 'ro',
  displayCurrency: 'RON',
  sessionVersion: 1,
} satisfies SessionUser

// id-ul real al adminului (FK pe users.sent_by_user_id) — fixture-ul de mai sus rămâne static
// în restul câmpurilor.
const [adminRoleRow] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const [adminUserRow] = await db.select({ id: users.id }).from(users).where(eq(users.roleId, adminRoleRow!.id)).limit(1)
admin.id = adminUserRow!.id


const threadIds: string[] = []
const messageIds: string[] = []

afterEach(() => sendEmailWithResultMock.mockReset())
afterAll(async () => {
  if (messageIds.length) await db.delete(emailMessages).where(inArray(emailMessages.id, messageIds))
  if (threadIds.length) await db.delete(emailThreads).where(inArray(emailThreads.id, threadIds))
  await db.delete(emailSends).where(like(emailSends.subject, '%QA Forward/Reply%'))
})

async function makeThreadWithInboundMessage(overrides: { bodyText?: string; bodyHtml?: string | null } = {}) {
  const [thread] = await db
    .insert(emailThreads)
    .values({ subject: 'QA Forward/Reply', participants: ['client@extern.ro', 'stefan@vanadium.systems'], lastMessageAt: new Date() })
    .returning()
  threadIds.push(thread!.id)

  const [message] = await db
    .insert(emailMessages)
    .values({
      threadId: thread!.id,
      direction: 'in',
      fromAddress: 'client@extern.ro',
      toAddress: 'stefan@vanadium.systems',
      subject: 'QA Forward/Reply',
      bodyText: overrides.bodyText ?? 'Corp original, text simplu',
      bodyHtml: overrides.bodyHtml ?? null,
      receivedAt: new Date(),
    })
    .returning()
  messageIds.push(message!.id)

  return { thread: thread!, message: message! }
}

describe('replyToThread', () => {
  it('sends the rich-text HTML body as html and a plain-text derivation as text', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    const { thread } = await makeThreadWithInboundMessage()

    const reply = await replyToThread(admin, thread.id, '<p>Salut, <b>mulțumesc</b> de mesaj!</p>')
    messageIds.push(reply.id)

    const sentArgs = sendEmailWithResultMock.mock.calls[0]![0]
    expect(sentArgs.html).toContain('<p>Salut, <b>mulțumesc</b> de mesaj!</p>')
    expect(sentArgs.text).toContain('Salut, mulțumesc de mesaj!')
    expect(sentArgs.text).not.toContain('<b>')
  })

  it('persists both bodyHtml (raw) and bodyText (derived) on the mirrored message', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    const { thread } = await makeThreadWithInboundMessage()

    const reply = await replyToThread(admin, thread.id, '<p>Text <i>simplu</i> aici</p>')
    messageIds.push(reply.id)

    const [row] = await db.select().from(emailMessages).where(eq(emailMessages.id, reply.id))
    expect(row?.bodyHtml).toBe('<p>Text <i>simplu</i> aici</p>')
    expect(row?.bodyText).toContain('Text simplu aici')
  })

  it('inlines a stored editor image as a cid: MIME attachment (2026-08-11)', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    const { thread } = await makeThreadWithInboundMessage()
    const filename = `${randomUUID()}.png`
    await saveDocument(emailImageStoragePath(filename), Buffer.from([1, 2, 3]))

    const reply = await replyToThread(admin, thread.id, `<p>Uite:</p><img src="/api/email-images/${filename}">`)
    messageIds.push(reply.id)

    const sentArgs = sendEmailWithResultMock.mock.calls[0]![0]
    expect(sentArgs.html).toContain(`cid:${filename}`)
    expect(sentArgs.attachments?.some((a) => a.contentId === filename)).toBe(true)
    expect(reply.bodyHtml).toContain(`/api/email-images/${filename}`)
  })

  it('mirrors the reply into email_sends, so it shows up in the "Trimise" tab (bug fix 2026-09-07)', async () => {
    const resendEmailId = `resend-${randomUUID()}`
    sendEmailWithResultMock.mockResolvedValue({ ok: true, id: resendEmailId })
    const { thread } = await makeThreadWithInboundMessage()

    const reply = await replyToThread(admin, thread.id, '<p>Test oglindire în Trimise</p>')
    messageIds.push(reply.id)

    const [sendRow] = await db.select().from(emailSends).where(eq(emailSends.resendEmailId, resendEmailId))
    expect(sendRow?.status).toBe('sent')
    expect(sendRow?.recipient).toBe('client@extern.ro')
    expect(sendRow?.bodyHtml).toContain('Test oglindire în Trimise')
  })
})

describe('forwardMessage', () => {
  it('keeps the new HTML body real (not double-escaped) while quoting the original', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    const { message } = await makeThreadWithInboundMessage({ bodyText: 'Corpul original' })

    const forwarded = await forwardMessage(admin, message.id, {
      to: 'altcineva@exemplu.ro',
      extraBody: '<p>Uite ce am primit, <strong>important</strong>:</p>',
      includeOriginalAttachments: false,
    })
    messageIds.push(forwarded.id)

    const sentArgs = sendEmailWithResultMock.mock.calls[0]![0]
    // Tag-urile reale ale utilizatorului NU trebuie să apară escapate (&lt;strong&gt;) — asta
    // era bug-ul: textToHtmlParagraph pe întregul `quoted` concatenat escapa HTML-ul real.
    expect(sentArgs.html).toContain('<strong>important</strong>')
    expect(sentArgs.html).not.toContain('&lt;strong&gt;')
    expect(sentArgs.html).toContain('Mesaj redirecționat')
    expect(sentArgs.html).toContain('Corpul original')
  })

  it('plain-text version has no leftover HTML tags from extraBody', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    const { message } = await makeThreadWithInboundMessage({ bodyText: 'Original' })

    const forwarded = await forwardMessage(admin, message.id, {
      to: 'altcineva@exemplu.ro',
      extraBody: '<p>Salut <em>tu</em></p>',
      includeOriginalAttachments: false,
    })
    messageIds.push(forwarded.id)

    const sentArgs = sendEmailWithResultMock.mock.calls[0]![0]
    expect(sentArgs.text).toContain('Salut tu')
    expect(sentArgs.text).not.toContain('<em>')
  })

  it('quotes the original using its bodyHtml when available, falling back to bodyText otherwise', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    const { message } = await makeThreadWithInboundMessage({ bodyText: 'plain fallback', bodyHtml: '<p>original <u>html</u></p>' })

    const forwarded = await forwardMessage(admin, message.id, { to: 'x@exemplu.ro', extraBody: '<p>fwd</p>', includeOriginalAttachments: false })
    messageIds.push(forwarded.id)

    const sentArgs = sendEmailWithResultMock.mock.calls[0]![0]
    expect(sentArgs.html).toContain('<u>html</u>')
  })

  it('works with no extraBody at all (pure forward, no added message)', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    const { message } = await makeThreadWithInboundMessage({ bodyText: 'Original gol' })

    const forwarded = await forwardMessage(admin, message.id, { to: 'x@exemplu.ro', includeOriginalAttachments: false })
    messageIds.push(forwarded.id)

    expect(sendEmailWithResultMock).toHaveBeenCalledTimes(1)
    const sentArgs = sendEmailWithResultMock.mock.calls[0]![0]
    expect(sentArgs.html).toContain('Original gol')
  })

  it('inlines a stored editor image from extraBody as a cid: MIME attachment (2026-08-11)', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    const { message } = await makeThreadWithInboundMessage({ bodyText: 'Original' })
    const filename = `${randomUUID()}.png`
    await saveDocument(emailImageStoragePath(filename), Buffer.from([1, 2, 3]))

    const forwarded = await forwardMessage(admin, message.id, {
      to: 'x@exemplu.ro',
      extraBody: `<img src="/api/email-images/${filename}">`,
      includeOriginalAttachments: false,
    })
    messageIds.push(forwarded.id)

    const sentArgs = sendEmailWithResultMock.mock.calls[0]![0]
    expect(sentArgs.html).toContain(`cid:${filename}`)
    expect(sentArgs.attachments?.some((a) => a.contentId === filename)).toBe(true)
  })

  it('mirrors the forward into email_sends, so it shows up in the "Trimise" tab (bug fix 2026-09-07)', async () => {
    const resendEmailId = `resend-${randomUUID()}`
    sendEmailWithResultMock.mockResolvedValue({ ok: true, id: resendEmailId })
    const { message } = await makeThreadWithInboundMessage({ bodyText: 'Original' })

    const forwarded = await forwardMessage(admin, message.id, {
      to: 'x@exemplu.ro',
      extraBody: '<p>fwd cu oglindire</p>',
      includeOriginalAttachments: false,
    })
    messageIds.push(forwarded.id)

    const [sendRow] = await db.select().from(emailSends).where(eq(emailSends.resendEmailId, resendEmailId))
    expect(sendRow?.status).toBe('sent')
    expect(sendRow?.recipient).toBe('x@exemplu.ro')
    expect(sendRow?.bodyHtml).toContain('fwd cu oglindire')
  })
})
