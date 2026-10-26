import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import {
  emailAttachments,
  emailMessages,
  emailSequenceEnrollments,
  emailSequences,
  emailThreads,
  emailTemplates,
  syncLog,
  userMailboxes,
  users,
} from '../../shared/db/schema/index.js'
import { notifyPush } from '../../shared/lib/push.js'
import {
  getRecentAddresses,
  ingestCloudflareInboundEmail,
  listThreads,
  normalizeSubject,
  processCloudflareInboundWebhookEvent,
  type CloudflareInboundPayload,
} from './inbound-service.js'
import { createSequence, enrollRecipients } from './sequences-service.js'
import { effectiveFeatures } from '../../shared/lib/session.js'
import type { SessionUser } from '../../shared/lib/session.js'

// Push-ul e mock-uit ca să putem aserta pe lista de oameni anunțați (C2); fără VAPID/FCM
// configurate în teste ar fi oricum no-op.
vi.mock('../../shared/lib/push.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../shared/lib/push.js')>()),
  notifyPush: vi.fn(async () => {}),
}))

const [stefanRow] = await db.select({ id: users.id }).from(users).where(eq(users.isPlatformAdmin, true)).limit(1)
const stefanId = stefanRow!.id

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


describe('normalizeSubject', () => {
  it('leaves a plain subject untouched', () => {
    expect(normalizeSubject('Salut de la client')).toBe('Salut de la client')
  })

  it('strips a single Re: prefix, case-insensitive', () => {
    expect(normalizeSubject('Re: Salut')).toBe('Salut')
    expect(normalizeSubject('re: Salut')).toBe('Salut')
    expect(normalizeSubject('RE:Salut')).toBe('Salut')
  })

  it('strips Fwd:/Fw: prefixes', () => {
    expect(normalizeSubject('Fwd: Salut')).toBe('Salut')
    expect(normalizeSubject('Fw: Salut')).toBe('Salut')
  })

  it('strips repeated/mixed prefixes (Re: Fwd: Re: ...)', () => {
    expect(normalizeSubject('Re: Fwd: Re: Salut')).toBe('Salut')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeSubject('   Re:   Salut   ')).toBe('Salut')
  })

  it('does not strip Re: appearing mid-subject', () => {
    expect(normalizeSubject('Salut Re: tot')).toBe('Salut Re: tot')
  })
})

/**
 * ingestCloudflareInboundEmail / processCloudflareInboundWebhookEvent (Sprint D, Track 5).
 * Integration test, pg real (test/setup.ts) — payload-ul Cloudflare vine complet dintr-un
 * singur POST (nu doar o notificare ca la Resend), deci nu mockuim niciun fetch extern aici.
 * Nu asertăm pe `folder` exact (euristica de spam e testată separat, altundeva) — doar că
 * mesajul e creat corect și comportamentul SPECIFIC căii Cloudflare (dedup pe
 * sourceMessageId, atașamente din base64, messageId null) funcționează.
 */
describe('ingestCloudflareInboundEmail', () => {
  const threadIds: string[] = []

  function payload(overrides: Partial<CloudflareInboundPayload> = {}): CloudflareInboundPayload {
    return {
      from: 'cineva@extern.ro',
      to: 'stefan@vanadium.systems',
      subject: `QA Cloudflare Inbound ${Math.random().toString(36).slice(2)}`,
      text: 'Corp mesaj de test',
      html: null,
      messageId: `<${Math.random().toString(36).slice(2)}@extern.ro>`,
      attachments: [],
      ...overrides,
    }
  }

  async function cleanupByThreadSubject(subject: string) {
    const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.subject, subject))
    if (!thread) return
    const messages = await db.select({ id: emailMessages.id }).from(emailMessages).where(eq(emailMessages.threadId, thread.id))
    const messageIds = messages.map((m) => m.id)
    if (messageIds.length) await db.delete(emailAttachments).where(inArray(emailAttachments.messageId, messageIds))
    await db.delete(emailMessages).where(eq(emailMessages.threadId, thread.id))
    await db.delete(emailThreads).where(eq(emailThreads.id, thread.id))
  }

  afterAll(async () => {
    for (const subject of threadIds) await cleanupByThreadSubject(subject)
    await db.delete(syncLog).where(eq(syncLog.jobKey, 'email:cloudflare-inbound'))
  })

  it('puts a message that fails DMARC in spam', async () => {
    const p = payload({ dmarc: 'fail' })
    threadIds.push(p.subject)

    expect(await ingestCloudflareInboundEmail(p)).toBe(true)

    const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.subject, p.subject))
    const [message] = await db.select().from(emailMessages).where(eq(emailMessages.threadId, thread!.id))
    expect(message?.folder).toBe('spam')
  })

  it('creates a thread + message with direction=in, inboundSource=cloudflare, sourceMessageId set', async () => {
    const p = payload()
    threadIds.push(p.subject)

    const inserted = await ingestCloudflareInboundEmail(p)
    expect(inserted).toBe(true)

    const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.subject, p.subject))
    expect(thread).toBeDefined()
    const [message] = await db.select().from(emailMessages).where(eq(emailMessages.threadId, thread!.id))
    expect(message?.direction).toBe('in')
    expect(message?.inboundSource).toBe('cloudflare')
    expect(message?.sourceMessageId).toBe(p.messageId)
    expect(message?.resendEmailId).toBeNull()
    expect(message?.fromAddress).toBe(p.from)
    expect(message?.toAddress).toBe(p.to)
  })

  it('falls back to html body (convertit la text simplu) când text e null', async () => {
    // Bug găsit de Stefan (2026-07-18, mesaje ANAF SPV) — HTML-ul brut ajungea stocat cu
    // tag-uri vizibile în UI. Acum se convertește la text simplu (html-to-text.ts).
    const p = payload({ text: null, html: '<p>doar html</p>' })
    threadIds.push(p.subject)

    await ingestCloudflareInboundEmail(p)
    const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.subject, p.subject))
    const [message] = await db.select().from(emailMessages).where(eq(emailMessages.threadId, thread!.id))
    expect(message?.bodyText).toBe('doar html')
  })

  it('idempotent: a second call with the SAME messageId is ignored (dedup on sourceMessageId, partial unique index)', async () => {
    const p = payload()
    threadIds.push(p.subject)

    expect(await ingestCloudflareInboundEmail(p)).toBe(true)
    expect(await ingestCloudflareInboundEmail(p)).toBe(false)

    const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.subject, p.subject))
    const messages = await db.select().from(emailMessages).where(eq(emailMessages.threadId, thread!.id))
    expect(messages).toHaveLength(1)
  })

  it('messageId=null (no Message-ID header): still inserts, no dedup key, does not crash', async () => {
    const p = payload({ messageId: null })
    threadIds.push(p.subject)

    expect(await ingestCloudflareInboundEmail(p)).toBe(true)
    const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.subject, p.subject))
    const [message] = await db.select().from(emailMessages).where(eq(emailMessages.threadId, thread!.id))
    expect(message?.sourceMessageId).toBeNull()
  })

  it('persists attachments decoded from contentBase64', async () => {
    const content = Buffer.from('continut de test').toString('base64')
    const p = payload({ attachments: [{ filename: 'test.txt', contentType: 'text/plain', contentBase64: content }] })
    threadIds.push(p.subject)

    await ingestCloudflareInboundEmail(p)
    const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.subject, p.subject))
    const [message] = await db.select().from(emailMessages).where(eq(emailMessages.threadId, thread!.id))
    const attachments = await db.select().from(emailAttachments).where(eq(emailAttachments.messageId, message!.id))
    expect(attachments).toHaveLength(1)
    expect(attachments[0]?.filename).toBe('test.txt')
    expect(attachments[0]?.contentType).toBe('text/plain')
  })

  it('salvează bodyHtml brut, NESANITIZAT (sanitizarea e strict client-side, Sprint 3)', async () => {
    const p = payload({ text: 'text simplu', html: '<p onclick="alert(1)">html brut cu markup potențial periculos</p>' })
    threadIds.push(p.subject)

    await ingestCloudflareInboundEmail(p)
    const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.subject, p.subject))
    const [message] = await db.select().from(emailMessages).where(eq(emailMessages.threadId, thread!.id))
    expect(message?.bodyHtml).toBe(p.html)
    expect(message?.bodyText).toBe('text simplu') // bodyText rămâne cel trimis explicit, nu derivat din html
  })

  it('bodyHtml rămâne null când payload-ul n-are html', async () => {
    const p = payload({ html: null })
    threadIds.push(p.subject)

    await ingestCloudflareInboundEmail(p)
    const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.subject, p.subject))
    const [message] = await db.select().from(emailMessages).where(eq(emailMessages.threadId, thread!.id))
    expect(message?.bodyHtml).toBeNull()
  })

  it('persistă contentId/disposition pe atașamente (leagă <img src="cid:..."> de atașamentul inline)', async () => {
    const content = Buffer.from('fake-png-bytes').toString('base64')
    const p = payload({
      html: '<img src="cid:logo123">',
      attachments: [
        {
          filename: 'logo.png',
          contentType: 'image/png',
          contentBase64: content,
          contentId: 'logo123',
          disposition: 'inline',
        },
      ],
    })
    threadIds.push(p.subject)

    await ingestCloudflareInboundEmail(p)
    const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.subject, p.subject))
    const [message] = await db.select().from(emailMessages).where(eq(emailMessages.threadId, thread!.id))
    const attachments = await db.select().from(emailAttachments).where(eq(emailAttachments.messageId, message!.id))
    expect(attachments[0]?.contentId).toBe('logo123')
    expect(attachments[0]?.disposition).toBe('inline')
  })

  it('contentId/disposition absente în payload → rămân null (atașamente normale, nu inline)', async () => {
    const content = Buffer.from('continut').toString('base64')
    const p = payload({ attachments: [{ filename: 'doc.pdf', contentType: 'application/pdf', contentBase64: content }] })
    threadIds.push(p.subject)

    await ingestCloudflareInboundEmail(p)
    const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.subject, p.subject))
    const [message] = await db.select().from(emailMessages).where(eq(emailMessages.threadId, thread!.id))
    const attachments = await db.select().from(emailAttachments).where(eq(emailAttachments.messageId, message!.id))
    expect(attachments[0]?.contentId).toBeNull()
    expect(attachments[0]?.disposition).toBeNull()
  })

  it('does NOT collide with an existing Resend-sourced message even with a similar subject (different inboundSource)', async () => {
    // Un thread cu același subiect normalizat, dar mesaj EXISTENT pe calea Resend
    // (inboundSource default 'resend', sourceMessageId null) — un mesaj Cloudflare nou pe
    // același thread nu trebuie blocat de partial unique index-ul de pe calea 'cloudflare'.
    const subject = `QA Cloudflare Coexist ${Math.random().toString(36).slice(2)}`
    threadIds.push(subject)
    const [thread] = await db.insert(emailThreads).values({ subject, participants: ['cineva@extern.ro', 'stefan@vanadium.systems'], lastMessageAt: new Date() }).returning()
    await db.insert(emailMessages).values({
      threadId: thread!.id,
      direction: 'in',
      resendEmailId: 're_existing_123',
      fromAddress: 'cineva@extern.ro',
      toAddress: 'stefan@vanadium.systems',
      subject,
      receivedAt: new Date(),
    })

    const p = payload({ subject, from: 'cineva@extern.ro', to: 'stefan@vanadium.systems' })
    const inserted = await ingestCloudflareInboundEmail(p)
    expect(inserted).toBe(true)

    const messages = await db.select().from(emailMessages).where(eq(emailMessages.threadId, thread!.id))
    expect(messages).toHaveLength(2)
  })

  it('processCloudflareInboundWebhookEvent logs SUCCESS in sync_log and never throws, even on internal failure', async () => {
    const p = payload()
    threadIds.push(p.subject)

    await expect(processCloudflareInboundWebhookEvent(p)).resolves.toBeUndefined()

    const [log] = await db
      .select()
      .from(syncLog)
      .where(and(eq(syncLog.jobKey, 'email:cloudflare-inbound'), eq(syncLog.status, 'SUCCESS')))
      .orderBy(syncLog.startedAt)
    expect(log).toBeDefined()
  })
})

/**
 * getRecentAddresses — autocomplete la "Către" în ComposeDialog.tsx. Stefan a raportat că
 * dropdown-ul nu apare deloc la compunere — testat aici la nivel de logică de business, ca
 * să izolăm dacă bug-ul e în backend (query greșit) sau strict în UI (nimic de reparat aici
 * dacă testele astea trec, semn că datele întoarse sunt corecte).
 */
describe('getRecentAddresses (2026-08-11 — bug Stefan, dropdown gol la Compose)', () => {
  const threadIds: string[] = []
  const messageIds: string[] = []

  afterAll(async () => {
    if (messageIds.length) await db.delete(emailMessages).where(inArray(emailMessages.id, messageIds))
    if (threadIds.length) await db.delete(emailThreads).where(inArray(emailThreads.id, threadIds))
  })

  async function makeThread(subject: string) {
    const [thread] = await db.insert(emailThreads).values({ subject, participants: [], lastMessageAt: new Date() }).returning()
    threadIds.push(thread!.id)
    return thread!
  }

  async function makeMessage(overrides: Partial<typeof emailMessages.$inferInsert> & { subject: string }) {
    const thread = await makeThread(overrides.subject)
    const [message] = await db
      .insert(emailMessages)
      .values({
        threadId: thread.id,
        direction: 'out',
        fromAddress: 'stefan@vanadium.systems',
        toAddress: 'someone@example.com',
        ...overrides,
      })
      .returning()
    messageIds.push(message!.id)
    return message!
  }

  it('includes an address a message was sent TO (direction=out)', async () => {
    await makeMessage({ subject: 'QA recent-1', direction: 'out', toAddress: 'qa-recent-out@example.com' })
    const addresses = await getRecentAddresses(admin, 100)
    expect(addresses.map((a) => a.toLowerCase())).toContain('qa-recent-out@example.com')
  })

  it('includes an address a message was received FROM (direction=in)', async () => {
    await makeMessage({ subject: 'QA recent-2', direction: 'in', fromAddress: 'qa-recent-in@example.com', receivedAt: new Date() })
    const addresses = await getRecentAddresses(admin, 100)
    expect(addresses.map((a) => a.toLowerCase())).toContain('qa-recent-in@example.com')
  })

  it('excludes a soft-deleted message', async () => {
    const msg = await makeMessage({ subject: 'QA recent-deleted', toAddress: 'qa-recent-deleted@example.com' })
    await db.update(emailMessages).set({ deletedAt: new Date() }).where(eq(emailMessages.id, msg.id))
    const addresses = await getRecentAddresses(admin, 100)
    expect(addresses.map((a) => a.toLowerCase())).not.toContain('qa-recent-deleted@example.com')
  })

  it('deduplicates the same address seen in both sent and received messages (case-insensitive)', async () => {
    await makeMessage({ subject: 'QA recent-dup-1', direction: 'out', toAddress: 'QA-Dup@example.com' })
    await makeMessage({ subject: 'QA recent-dup-2', direction: 'in', fromAddress: 'qa-dup@example.com', receivedAt: new Date() })
    const addresses = await getRecentAddresses(admin, 100)
    const matches = addresses.filter((a) => a.toLowerCase() === 'qa-dup@example.com')
    expect(matches).toHaveLength(1)
  })

  it('respects the limit parameter', async () => {
    for (let i = 0; i < 5; i++) {
      await makeMessage({ subject: `QA recent-limit-${i}`, toAddress: `qa-recent-limit-${i}@example.com` })
    }
    const addresses = await getRecentAddresses(admin, 2)
    expect(addresses.length).toBeLessThanOrEqual(2)
  })

  it('leaves out addresses from mailboxes the person does not have', async () => {
    await makeMessage({ subject: 'QA recent-other-box', direction: 'out', toAddress: 'qa-recent-other@example.com' })
    const addresses = await getRecentAddresses({ ...admin, mailboxes: [] }, 100)
    expect(addresses).toEqual([])
  })
})

describe('listThreads — q fuzzy (2026-09-03, bug real Stefan: "dacă nu dau FIX adresa sau titlul nu-l găsește")', () => {
  const threadIds: string[] = []

  afterAll(async () => {
    if (threadIds.length) await db.delete(emailThreads).where(inArray(emailThreads.id, threadIds))
  })

  async function makeThread(subject: string, participants: string[]) {
    const [thread] = await db.insert(emailThreads).values({ subject, participants, lastMessageAt: new Date() }).returning()
    threadIds.push(thread!.id)
    return thread!
  }

  it('matches a participant address by substring — nu doar subiectul (gap real, adresele nu erau deloc căutate)', async () => {
    const thread = await makeThread('QA fuzzy participant', ['stefan@vanadium.systems', 'qa-fuzzy-participant@acme-test.ro'])
    const items = await listThreads(admin, { q: 'acme-test' })
    expect(items.some((t) => t.id === thread.id)).toBe(true)
  })

  it('matches a subject with a single-letter typo via trigram similarity, not just exact word match', async () => {
    const thread = await makeThread('QA fuzzy Salutare speciala', [])
    const items = await listThreads(admin, { q: 'Slautare speciala' })
    expect(items.some((t) => t.id === thread.id)).toBe(true)
  })

  it('returns nothing for a term unrelated to subject or participants', async () => {
    const thread = await makeThread('QA fuzzy no-match', ['qa-fuzzy-no-match@example.com'])
    const items = await listThreads(admin, { q: 'complet-altceva-neasociat' })
    expect(items.some((t) => t.id === thread.id)).toBe(false)
  })
})

describe('listThreads — attachmentNames exclude disposition=inline (2026-09-03, bug real Stefan: poze de estetica emailului apăreau ca atașamente)', () => {
  const threadIds: string[] = []
  const messageIds: string[] = []

  afterAll(async () => {
    if (messageIds.length) await db.delete(emailAttachments).where(inArray(emailAttachments.messageId, messageIds))
    if (messageIds.length) await db.delete(emailMessages).where(inArray(emailMessages.id, messageIds))
    if (threadIds.length) await db.delete(emailThreads).where(inArray(emailThreads.id, threadIds))
  })

  async function makeThreadWithMessage(subject: string) {
    const [thread] = await db.insert(emailThreads).values({ subject, participants: [], lastMessageAt: new Date() }).returning()
    threadIds.push(thread!.id)
    const [message] = await db
      .insert(emailMessages)
      .values({
        threadId: thread!.id,
        direction: 'in',
        fromAddress: 'sender@example.com',
        toAddress: 'stefan@vanadium.systems',
        subject,
        receivedAt: new Date(),
      })
      .returning()
    messageIds.push(message!.id)
    return { thread: thread!, message: message! }
  }

  it('excludes inline images (logo/semnătură) from attachmentNames and hasAttachment, keeps the real attachment', async () => {
    const { thread, message } = await makeThreadWithMessage('QA attach filter')
    await db.insert(emailAttachments).values([
      { messageId: message.id, filename: 'image001.png', storagePath: 'x', contentType: 'image/png', contentId: '<img001>', disposition: 'inline' },
      { messageId: message.id, filename: 'image002.jpg', storagePath: 'x', contentType: 'image/jpeg', contentId: '<img002>', disposition: 'inline' },
      { messageId: message.id, filename: 'BRG159717.pdf', storagePath: 'x', contentType: 'application/pdf', disposition: 'attachment' },
    ])

    const items = await listThreads(admin, { q: undefined })
    const found = items.find((t) => t.id === thread.id)
    expect(found?.attachmentNames).toEqual(['BRG159717.pdf'])
    expect(found?.hasAttachment).toBe(true)
  })

  it('treats a NULL disposition as a real attachment (senders that omit Content-Disposition)', async () => {
    const { thread, message } = await makeThreadWithMessage('QA attach null disposition')
    await db.insert(emailAttachments).values([{ messageId: message.id, filename: 'no-disposition.pdf', storagePath: 'x', contentType: 'application/pdf' }])

    const items = await listThreads(admin, { q: undefined })
    const found = items.find((t) => t.id === thread.id)
    expect(found?.attachmentNames).toEqual(['no-disposition.pdf'])
  })

  it('hasAttachment is false when every attachment is inline', async () => {
    const { thread, message } = await makeThreadWithMessage('QA attach only inline')
    await db.insert(emailAttachments).values([{ messageId: message.id, filename: 'logo.png', storagePath: 'x', contentType: 'image/png', disposition: 'inline' }])

    const items = await listThreads(admin, { q: undefined })
    const found = items.find((t) => t.id === thread.id)
    expect(found?.hasAttachment).toBe(false)
    expect(found?.attachmentNames).toEqual([])
  })
})

/**
 * Hook de oprire la răspuns (2026-08-12, sprint Secvențe outreach) — la ingest-ul unui mesaj
 * primit, orice enrollment activ al adresei expeditorului trece pe 'replied' (vezi PLAN.md,
 * stopSequencesForReplyFrom în sequences-service.js — testat izolat acolo; aici verificăm doar
 * că ingestCloudflareInboundEmail chiar apelează hook-ul, pe calea reală de ingest).
 */
describe('ingestCloudflareInboundEmail — oprire secvențe la răspuns', () => {
  const threadIds: string[] = []
  const templateIds: string[] = []
  const sequenceIds: string[] = []

  async function cleanupByThreadSubject(subject: string) {
    const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.subject, subject))
    if (!thread) return
    await db.delete(emailMessages).where(eq(emailMessages.threadId, thread.id))
    await db.delete(emailThreads).where(eq(emailThreads.id, thread.id))
  }

  afterAll(async () => {
    for (const subject of threadIds) await cleanupByThreadSubject(subject)
    if (sequenceIds.length) await db.delete(emailSequences).where(inArray(emailSequences.id, sequenceIds.splice(0)))
    if (templateIds.length) await db.delete(emailTemplates).where(inArray(emailTemplates.id, templateIds.splice(0)))
  })

  it('flips an active enrollment for the sender to replied when their email is ingested', async () => {
    const [tpl] = await db.insert(emailTemplates).values({ name: 'QA reply-hook template', subject: 'S', body: 'B' }).returning()
    templateIds.push(tpl!.id)
    const seq = await createSequence(admin, { name: 'QA reply-hook sequence', fromIdentity: 'contact', steps: [{ templateId: tpl!.id, delayDays: 0 }] })
    sequenceIds.push(seq.id)
    const senderEmail = `qa-reply-hook-${Math.random().toString(36).slice(2)}@extern.ro`
    await enrollRecipients(seq.id, [{ email: senderEmail }])

    const subject = `QA reply-hook ${Math.random().toString(36).slice(2)}`
    threadIds.push(subject)
    await ingestCloudflareInboundEmail({
      from: senderEmail,
      to: 'contact@vanadium.systems',
      subject,
      text: 'Răspuns real',
      html: null,
      messageId: `<${Math.random().toString(36).slice(2)}@extern.ro>`,
      attachments: [],
    })

    const [enrollment] = await db.select().from(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.sequenceId, seq.id))
    expect(enrollment?.status).toBe('replied')
  })
})

/**
 * Push-ul de email nou (C2, BE-6): îl primesc oamenii care au cutia pe care a venit mesajul,
 * nu toți abonații — și cine și-a oprit notificările de email nu-l mai primește.
 */
describe('ingestCloudflareInboundEmail — push către oamenii cutiei', () => {
  const threadIds: string[] = []
  const colleagueIds: string[] = []

  async function cleanupByThreadSubject(subject: string) {
    const [thread] = await db.select().from(emailThreads).where(eq(emailThreads.subject, subject))
    if (!thread) return
    await db.delete(emailMessages).where(eq(emailMessages.threadId, thread.id))
    await db.delete(emailThreads).where(eq(emailThreads.id, thread.id))
  }

  async function makeColleague(email: string, identityKey: string | null, emailNew: boolean) {
    const [row] = await db
      .insert(users)
      .values({
        email,
        passwordHash: 'x',
        displayName: email,
        notificationPrefs: { chat: 'all', emailNew, alerts: true },
      })
      .returning()
    colleagueIds.push(row!.id)
    if (identityKey) {
      await db.insert(userMailboxes).values({ userId: row!.id, identityKey })
    }
    return row!.id
  }

  function ingest(to: string): Promise<boolean> {
    const subject = `QA push cutie ${Math.random().toString(36).slice(2)}`
    threadIds.push(subject)
    return ingestCloudflareInboundEmail({
      from: 'cineva@extern.ro',
      to,
      subject,
      text: 'Corp',
      html: null,
      messageId: `<${Math.random().toString(36).slice(2)}@extern.ro>`,
      attachments: [],
    })
  }

  function lastPush() {
    const call = vi.mocked(notifyPush).mock.calls.at(-1)
    return call ? { eventType: call[0], userIds: call[2] } : null
  }

  beforeEach(() => {
    vi.mocked(notifyPush).mockClear()
  })

  afterAll(async () => {
    for (const subject of threadIds) await cleanupByThreadSubject(subject)
    if (colleagueIds.length) {
      await db.delete(userMailboxes).where(inArray(userMailboxes.userId, colleagueIds))
      await db.delete(users).where(inArray(users.id, colleagueIds))
    }
  })

  it('anunță doar pe cei cu cutia respectivă: adminul (toate cutiile) + colegul de pe contact', async () => {
    const withContact = await makeColleague(`qa-cutie-${Math.random().toString(36).slice(2)}@vanadium.systems`, 'contact', true)
    const withStefan = await makeColleague(`qa-cutie-${Math.random().toString(36).slice(2)}@vanadium.systems`, 'stefan', true)

    expect(await ingest('contact@vanadium.systems')).toBe(true)
    const push = lastPush()
    expect(push?.eventType).toBe('email')
    expect(push?.userIds).toContain(withContact)
    expect(push?.userIds).toContain(stefanId)
    expect(push?.userIds).not.toContain(withStefan)
  })

  it('cine are notificationPrefs.emailNew = false nu e anunțat', async () => {
    const muted = await makeColleague(`qa-cutie-${Math.random().toString(36).slice(2)}@vanadium.systems`, 'contact', false)
    expect(await ingest('contact@vanadium.systems')).toBe(true)
    expect(lastPush()?.userIds).not.toContain(muted)
  })

  it('adresă care nu e identitate configurată → niciun push, nicio excepție', async () => {
    expect(await ingest('necunoscuta@vanadium.systems')).toBe(true)
    expect(vi.mocked(notifyPush)).not.toHaveBeenCalled()
  })
})
