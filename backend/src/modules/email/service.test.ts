/**
 * Integration test — pg real (test/setup.ts), Resend mocked at module level (never
 * hit the real API). Covers the two guarantees called out explicitly in PLAN.md:
 * dedup on (recipient, templateId) and per-recipient failure isolation, plus the
 * unsubscribe footer / {{nume}} rendering.
 */
import { randomUUID } from 'node:crypto'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { config } from '../../shared/config.js'
import { db } from '../../shared/db/client.js'
import { emailDrafts, emailSends, emailSuppressions, emailTemplates, roles, users } from '../../shared/db/schema/index.js'
import type { EmailAttachment, SendEmailResult } from '../../shared/lib/email.js'
import { saveDocument } from '../../shared/lib/storage.js'
import { emailImageStoragePath } from './images-service.js'
import { getIdentities } from './settings-service.js'

import { effectiveFeatures } from '../../shared/lib/session.js'
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


const sendEmailWithResultMock =
  vi.fn<
    (opts: {
      to: string | string[]
      subject: string
      text: string
      html?: string
      from?: string
      headers?: Record<string, string>
      attachments?: EmailAttachment[]
    }) => Promise<SendEmailResult>
  >()

vi.mock('../../shared/lib/email.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/lib/email.js')>()
  return { ...actual, sendEmailWithResult: sendEmailWithResultMock, fetchReceivedEmail: async () => null }
})

const { bulkSend, getRecentBatchIds, getSendsReport, listSends, recordEngagementEvent, updateSendStatusFromWebhook } = await import('./service.js')
const { dispatchScheduledSend, sendNew } = await import('./scheduled-send.js')

// A 1:1 send now waits in the undo window; the tests make the row due and dispatch it by hand.
async function sendSingle(
  me: SessionUser,
  input: { to: string; subject: string; body: string; from: string; templateId?: string },
) {
  const { sendId } = await sendNew(me, { ...input, to: [input.to], cc: [] })
  await db
    .update(emailSends)
    .set({ sendAfter: sql`now() - interval '1 second'` })
    .where(eq(emailSends.id, sendId))
  await dispatchScheduledSend(sendId)
  const [row] = await db.select().from(emailSends).where(eq(emailSends.id, sendId))
  // A failed send leaves a draft behind for the person to fix; not what these tests look at.
  const draftId = (row!.payload as { draftId?: string } | null)?.draftId
  if (row!.status === 'failed' && draftId) await db.delete(emailDrafts).where(eq(emailDrafts.id, draftId))
  return row!
}

let templateId: string

beforeAll(async () => {
  const [tpl] = await db
    .insert(emailTemplates)
    .values({ name: 'Test outreach', subject: 'Salut {{nume}}', body: 'Bună {{nume}}, mesaj de test.' })
    .returning()
  templateId = tpl!.id
})

afterEach(() => {
  sendEmailWithResultMock.mockReset()
})

afterAll(async () => {
  await db.delete(emailSends).where(eq(emailSends.templateId, templateId))
  await db.delete(emailTemplates).where(eq(emailTemplates.id, templateId))
})

describe('bulkSend', () => {
  it('renders {{nume}} in body and subject, appends a real unsubscribe link + one-click headers', async () => {
    // EMAIL_UNSUBSCRIBE_SECRET setat (2026-08-11, fix bug Stefan — lipsea din .env, deci orice
    // bulk-send cădea pe fallback-ul static "răspunde cu 'dezabonare'").
    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    await bulkSend(admin, { templateId, recipients: [{ email: 'nume@example.com', nume: 'Andrei' }], from: 'contact' })

    expect(sendEmailWithResultMock).toHaveBeenCalledTimes(1)
    const sentArgs = sendEmailWithResultMock.mock.calls[0]![0]
    expect(sentArgs.text).toContain('Bună Andrei')
    expect(sentArgs.text).toMatch(/\/api\/email\/unsubscribe\/\S+/)
    expect(sentArgs.subject).toBe('Salut Andrei')
    expect(sentArgs.html).toContain('Dezabonează-te')
    expect(sentArgs.headers?.['List-Unsubscribe']).toMatch(/^<.*\/api\/email\/unsubscribe\/\S+>$/)
    expect(sentArgs.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })

  it('falls back to the static text and omits headers when EMAIL_UNSUBSCRIBE_SECRET is unset (fail-closed)', async () => {
    const original = config.emailUnsubscribeSecret
    config.emailUnsubscribeSecret = ''
    try {
      sendEmailWithResultMock.mockResolvedValue({ ok: true })
      await bulkSend(admin, { templateId, recipients: [{ email: 'no-secret@example.com', nume: 'Andrei' }], from: 'contact' })

      const sentArgs = sendEmailWithResultMock.mock.calls[0]![0]
      expect(sentArgs.text).toContain("răspunde cu 'dezabonare'")
      expect(sentArgs.html).not.toContain('Dezabonează-te')
      expect(sentArgs.headers).toBeUndefined()
    } finally {
      config.emailUnsubscribeSecret = original
    }
  })

  it('skips a recipient that already has a sent row for the same template (dedup)', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    const first = await bulkSend(admin, { templateId, recipients: [{ email: 'dup@example.com' }], from: 'contact' })
    expect(first.sent).toBe(1)
    expect(first.skipped).toBe(0)

    sendEmailWithResultMock.mockClear()
    const second = await bulkSend(admin, { templateId, recipients: [{ email: 'dup@example.com' }], from: 'contact' })
    expect(second.sent).toBe(0)
    expect(second.skipped).toBe(1)
    expect(sendEmailWithResultMock).not.toHaveBeenCalled()
  })

  it('isolates per-recipient failure — a failed send does not stop the rest of the batch', async () => {
    sendEmailWithResultMock.mockImplementation(async ({ to }) =>
      to === 'broken@example.com' ? { ok: false, error: 'Resend a răspuns cu HTTP 500' } : { ok: true },
    )
    const result = await bulkSend(admin, {
      templateId,
      recipients: [{ email: 'broken@example.com' }, { email: 'ok-after-broken@example.com' }],
      from: 'contact',
    })

    expect(result.failed).toBe(1)
    expect(result.sent).toBe(1)
    expect(result.results).toHaveLength(2)
    const failedRow = result.results.find((r) => r.recipient === 'broken@example.com')
    expect(failedRow?.status).toBe('failed')
    expect(failedRow?.errorMessage).toBe('Resend a răspuns cu HTTP 500')
  })

  it('groups every row of one bulk send under the same batchId, distinct from single sends', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    const result = await bulkSend(admin, {
      templateId,
      recipients: [{ email: 'batch-a@example.com' }, { email: 'batch-b@example.com' }],
      from: 'contact',
    })
    const batchIds = new Set(result.results.map((r) => r.batchId))
    expect(batchIds.size).toBe(1)
    expect(result.results[0]!.batchId).not.toBeNull()
  })

  describe('unsubscribe suppression (2026-08-11)', () => {
    const suppressionEmails: string[] = []
    afterAll(async () => {
      if (suppressionEmails.length) await db.delete(emailSuppressions).where(inArray(emailSuppressions.email, suppressionEmails))
    })

    it('skips a suppressed recipient without calling Resend, reports it under result.suppressed', async () => {
      suppressionEmails.push('unsub-skip@example.com')
      await db.insert(emailSuppressions).values({ email: 'unsub-skip@example.com' })
      sendEmailWithResultMock.mockResolvedValue({ ok: true })

      const result = await bulkSend(admin, { templateId, recipients: [{ email: 'unsub-skip@example.com' }], from: 'contact' })

      expect(result.suppressed).toBe(1)
      expect(result.sent).toBe(0)
      expect(sendEmailWithResultMock).not.toHaveBeenCalled()
      expect(result.results).toHaveLength(0) // niciun rând email_sends creat pt. cel suprimat
    })

    it('sends the non-suppressed recipient while skipping the suppressed one in the same batch', async () => {
      suppressionEmails.push('unsub-mixed-a@example.com')
      await db.insert(emailSuppressions).values({ email: 'unsub-mixed-a@example.com' })
      sendEmailWithResultMock.mockResolvedValue({ ok: true })

      const result = await bulkSend(admin, {
        templateId,
        recipients: [{ email: 'unsub-mixed-a@example.com' }, { email: 'unsub-mixed-b@example.com' }],
        from: 'contact',
      })

      expect(result.suppressed).toBe(1)
      expect(result.sent).toBe(1)
      expect(sendEmailWithResultMock).toHaveBeenCalledTimes(1)
      expect(sendEmailWithResultMock.mock.calls[0]![0].to).toBe('unsub-mixed-b@example.com')
    })

    it('matches a suppression regardless of the casing sent in the request', async () => {
      suppressionEmails.push('unsub-case@example.com')
      await db.insert(emailSuppressions).values({ email: 'unsub-case@example.com' })
      sendEmailWithResultMock.mockResolvedValue({ ok: true })

      const result = await bulkSend(admin, { templateId, recipients: [{ email: 'Unsub-Case@Example.com' }], from: 'contact' })

      expect(result.suppressed).toBe(1)
      expect(sendEmailWithResultMock).not.toHaveBeenCalled()
    })
  })
})

describe('listSends — q (căutare liberă în SentTab.tsx, 2026-09-03 — nu exista deloc înainte)', () => {
  it('matches a substring of the recipient address, case-insensitively', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    const unique = randomUUID()
    await bulkSend(admin, { templateId, recipients: [{ email: `Findme-${unique}@Example.com` }, { email: `other-${unique}@example.com` }], from: 'contact' })

    const { items } = await listSends(admin, { q: `findme-${unique}`, limit: 200, offset: 0 })
    expect(items).toHaveLength(1)
    expect(items[0]!.recipient.toLowerCase()).toBe(`findme-${unique}@example.com`.toLowerCase())
  })

  it('matches a substring of the subject', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    const unique = randomUUID()
    await bulkSend(admin, { templateId, recipients: [{ email: `subj-${unique}@example.com`, nume: `Unic${unique}` }], from: 'contact' })

    const { items } = await listSends(admin, { q: `Salut Unic${unique}`, limit: 200, offset: 0 })
    expect(items.some((r) => r.recipient === `subj-${unique}@example.com`)).toBe(true)
  })

  it('returns nothing for a term that matches neither recipient, subject, nor fromAddress', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    const unique = randomUUID()
    await bulkSend(admin, { templateId, recipients: [{ email: `qnomatch-${unique}@example.com` }], from: 'contact' })

    const { items } = await listSends(admin, { q: `nu-exista-${randomUUID()}`, limit: 200, offset: 0 })
    expect(items.some((r) => r.recipient === `qnomatch-${unique}@example.com`)).toBe(false)
  })
})

describe('Sent folder without email.bulk', () => {
  // A colleague with email.trimitere sees only what they sent; email.bulk sees the whole company.
  it('narrows list and report to the person\'s own sends and mailboxes', async () => {
    const unique = randomUUID()
    const mailbox = (await getIdentities()).find((identity) => identity.key !== 'stefan')
    const rows = await db
      .insert(emailSends)
      .values([
        { recipient: `own-${unique}@example.com`, subject: `Own ${unique}`, status: 'sent', sentByUserId: admin.id },
        { recipient: `other-${unique}@example.com`, subject: `Other ${unique}`, status: 'sent', sentByUserId: null },
        // A sequence send from a mailbox the colleague holds: no author, still theirs to see.
        { recipient: `box-${unique}@example.com`, subject: `Box ${unique}`, status: 'sent', sentByUserId: null, fromAddress: mailbox!.fromAddress },
      ])
      .returning({ id: emailSends.id })
    try {
      const colleague = { ...admin, features: ['email.view', 'email.trimitere'], mailboxes: [mailbox!.key] }
      const own = await listSends(colleague, { q: unique, limit: 200, offset: 0 })
      expect(own.items.map((r) => r.recipient).sort()).toEqual([`box-${unique}@example.com`, `own-${unique}@example.com`])

      const everyone = await listSends(admin, { q: unique, limit: 200, offset: 0 })
      expect(everyone.total).toBe(3)

      const mineOnly = await listSends(colleague, { q: unique, sentBy: 'me', limit: 200, offset: 0 })
      expect(mineOnly.items.map((r) => r.recipient)).toEqual([`own-${unique}@example.com`])
      const automatic = await listSends(colleague, { q: unique, sentBy: 'auto', limit: 200, offset: 0 })
      expect(automatic.items.map((r) => r.recipient)).toEqual([`box-${unique}@example.com`])

      const window = { from: new Date(Date.now() - 60_000).toISOString(), to: new Date(Date.now() + 60_000).toISOString() }
      const all = await getSendsReport(admin, window)
      const mine = await getSendsReport(colleague, window)
      expect(mine.totals.sent).toBeLessThan(all.totals.sent)
    } finally {
      await db.delete(emailSends).where(inArray(emailSends.id, rows.map((r) => r.id)))
    }
  })
})

describe('listSends — batchId filter (2026-08-11, persistă status-ul bulk-send-ului peste refresh)', () => {
  it('returns only the rows from the given batchId, excluding other batches', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    const batchResult = await bulkSend(admin, {
      templateId,
      recipients: [{ email: 'batch-filter-a@example.com' }, { email: 'batch-filter-b@example.com' }],
      from: 'contact',
    })
    const batchId = batchResult.results[0]!.batchId!

    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    await bulkSend(admin, { templateId, recipients: [{ email: 'other-batch@example.com' }], from: 'contact' })

    const { items, total } = await listSends(admin, { batchId, limit: 200, offset: 0 })
    expect(items).toHaveLength(2)
    expect(total).toBe(2)
    expect(items.every((r) => r.batchId === batchId)).toBe(true)
  })

  it('batchIds (comma-separated) accumulates rows from multiple batches, ignoring malformed ids', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    const first = await bulkSend(admin, { templateId, recipients: [{ email: 'multi-batch-a@example.com' }], from: 'contact' })
    const second = await bulkSend(admin, { templateId, recipients: [{ email: 'multi-batch-b@example.com' }], from: 'contact' })
    const batchIdA = first.results[0]!.batchId!
    const batchIdB = second.results[0]!.batchId!

    const { items } = await listSends(admin, { batchIds: `${batchIdA},not-a-uuid,${batchIdB}`, limit: 200, offset: 0 })
    expect(items.map((r) => r.recipient).sort()).toEqual(['multi-batch-a@example.com', 'multi-batch-b@example.com'])
  })

  it('flags isSuppressed on a row whose recipient later unsubscribed (2026-08-11 — Stefan nu vedea asta în UI)', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    const result = await bulkSend(admin, {
      templateId,
      recipients: [{ email: 'later-unsub@example.com' }, { email: 'stays-subscribed@example.com' }],
      from: 'contact',
    })
    const batchId = result.results[0]!.batchId!
    await db.insert(emailSuppressions).values({ email: 'later-unsub@example.com' })

    try {
      const { items } = await listSends(admin, { batchId, limit: 200, offset: 0 })
      const unsub = items.find((r) => r.recipient === 'later-unsub@example.com')
      const staysSub = items.find((r) => r.recipient === 'stays-subscribed@example.com')
      expect(unsub?.isSuppressed).toBe(true)
      expect(staysSub?.isSuppressed).toBe(false)
    } finally {
      await db.delete(emailSuppressions).where(eq(emailSuppressions.email, 'later-unsub@example.com'))
    }
  })
})

describe('updateSendStatusFromWebhook — bounce/complaint suprimă adresa (2026-08-21)', () => {
  afterEach(async () => {
    await db.delete(emailSuppressions).where(inArray(emailSuppressions.email, ['bounced-recipient@example.com', 'complained-recipient@example.com']))
  })

  it('suprimă destinatarul la un bounce, ca la un click de dezabonare — o secvență nu mai continuă pe el', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true, id: 'resend-bounce-id' })
    await sendSingle(admin, { to: 'bounced-recipient@example.com', subject: 'Hi', body: 'Body', from: 'stefan' })

    await updateSendStatusFromWebhook('resend-bounce-id', 'bounced', 'Mailbox does not exist')

    const [suppressed] = await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, 'bounced-recipient@example.com'))
    expect(suppressed).toBeDefined()
  })

  it('suprimă destinatarul la o plângere de spam', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true, id: 'resend-complaint-id' })
    await sendSingle(admin, { to: 'complained-recipient@example.com', subject: 'Hi', body: 'Body', from: 'stefan' })

    await updateSendStatusFromWebhook('resend-complaint-id', 'complained', null)

    const [suppressed] = await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, 'complained-recipient@example.com'))
    expect(suppressed).toBeDefined()
  })

  it('nu suprimă la un simplu delivered', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true, id: 'resend-delivered-id' })
    await sendSingle(admin, { to: 'stays-subscribed-delivered@example.com', subject: 'Hi', body: 'Body', from: 'stefan' })

    await updateSendStatusFromWebhook('resend-delivered-id', 'delivered', null)

    const [suppressed] = await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, 'stays-subscribed-delivered@example.com'))
    expect(suppressed).toBeUndefined()
  })
})

describe('sendSingle', () => {
  it('records a failed row with the error message when Resend fails, and batchId null', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: false, error: 'network down' })
    const row = await sendSingle(admin, { to: 'x@example.com', subject: 'Hi', body: 'Body', from: 'stefan' })
    expect(row.status).toBe('failed')
    expect(row.errorMessage).toBe('network down')
    expect(row.batchId).toBeNull()
  })

  it('records a sent row with no errorMessage on success', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    const row = await sendSingle(admin, { to: 'y@example.com', subject: 'Hi', body: 'Body', from: 'stefan' })
    expect(row.status).toBe('sent')
    expect(row.errorMessage).toBeNull()
  })

  it('rejects a well-formed but nonexistent templateId cleanly, before any insert (BUG-EMAIL-001)', async () => {
    await expect(
      sendSingle(admin, {
        to: 'ghost@example.com',
        subject: 'Hi',
        body: 'Body',
        templateId: '11111111-2222-3333-4444-555555555555',
        from: 'stefan',
      }),
    ).rejects.toThrow('Template inexistent')
    expect(sendEmailWithResultMock).not.toHaveBeenCalled()
  })

  it('inlines a stored editor image as a cid: MIME attachment, keeping the stored bodyHtml URL-based (2026-08-11)', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    const filename = `${randomUUID()}.png`
    await saveDocument(emailImageStoragePath(filename), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

    const row = await sendSingle(admin, {
      to: 'withimage@example.com',
      subject: 'Poză',
      body: `<p>Uite:</p><img src="/api/email-images/${filename}">`,
      from: 'stefan',
    })

    const sentArgs = sendEmailWithResultMock.mock.calls[0]![0]
    expect(sentArgs.html).toContain(`cid:${filename}`)
    expect(sentArgs.attachments?.some((a) => a.contentId === filename)).toBe(true)
    // bodyHtml persistat rămâne pe URL public (nu cid:) — editorul/thread view-ul îl reafișează.
    expect(row.bodyHtml).toContain(`/api/email-images/${filename}`)
    expect(row.bodyHtml).not.toContain('cid:')
  })
})

describe('recordEngagementEvent (2026-08-11 — webhook email.opened/email.clicked)', () => {
  it('sets openedAt on first open, keeps it fixed and only increments the count on repeat opens', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true, id: `resend-${randomUUID()}` })
    const row = await sendSingle(admin, { to: 'opens@example.com', subject: 'Hi', body: 'Body', from: 'stefan' })
    const resendEmailId = row.resendEmailId!

    await recordEngagementEvent(resendEmailId, 'opened', null)
    const [afterFirst] = await db.select().from(emailSends).where(eq(emailSends.id, row.id))
    expect(afterFirst!.openCount).toBe(1)
    expect(afterFirst!.openedAt).not.toBeNull()

    await recordEngagementEvent(resendEmailId, 'opened', null)
    const [afterSecond] = await db.select().from(emailSends).where(eq(emailSends.id, row.id))
    expect(afterSecond!.openCount).toBe(2)
    expect(afterSecond!.openedAt?.getTime()).toBe(afterFirst!.openedAt?.getTime())
  })

  it('sets clickedAt + lastClickedUrl on a click, updating the url on subsequent clicks', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true, id: `resend-${randomUUID()}` })
    const row = await sendSingle(admin, { to: 'clicks@example.com', subject: 'Hi', body: 'Body', from: 'stefan' })
    const resendEmailId = row.resendEmailId!

    await recordEngagementEvent(resendEmailId, 'clicked', 'https://vanadium.systems/produse/vanagreen')
    const [afterFirst] = await db.select().from(emailSends).where(eq(emailSends.id, row.id))
    expect(afterFirst!.clickCount).toBe(1)
    expect(afterFirst!.lastClickedUrl).toBe('https://vanadium.systems/produse/vanagreen')

    await recordEngagementEvent(resendEmailId, 'clicked', 'https://recycle.vanadium.systems/signup')
    const [afterSecond] = await db.select().from(emailSends).where(eq(emailSends.id, row.id))
    expect(afterSecond!.clickCount).toBe(2)
    expect(afterSecond!.lastClickedUrl).toBe('https://recycle.vanadium.systems/signup')
    expect(afterSecond!.clickedAt?.getTime()).toBe(afterFirst!.clickedAt?.getTime())
  })

  it('is a silent no-op for an unknown resendEmailId', async () => {
    await expect(recordEngagementEvent('does-not-exist', 'opened', null)).resolves.toBeUndefined()
  })
})

describe('getRecentBatchIds (2026-08-11 — BulkSendTab.tsx seedează batchIds din URL cu astea)', () => {
  it('returns distinct batch ids, most recently active first, respecting the limit', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    const a = await bulkSend(admin, { templateId, recipients: [{ email: 'recent-batch-a@example.com' }], from: 'contact' })
    const b = await bulkSend(admin, { templateId, recipients: [{ email: 'recent-batch-b@example.com' }], from: 'contact' })
    const idA = a.results[0]!.batchId!
    const idB = b.results[0]!.batchId!

    const recent = await getRecentBatchIds(50)
    expect(recent.indexOf(idB)).toBeLessThan(recent.indexOf(idA)) // b e mai nou, vine primul
    expect(new Set(recent).size).toBe(recent.length) // distinct

    const limited = await getRecentBatchIds(1)
    expect(limited).toEqual([idB])
  })
})
