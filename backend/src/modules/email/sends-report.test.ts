/**
 * getSendsReport — 'replied' (2026-08-27, bug raportat de Stefan: un reply la un email MANUAL
 * arăta 0 pt. că "replied" venea doar din emailSequenceEnrollments.status, absent pt. sends
 * fără secvență). Fereastră de timp fixă în trecut (2020) — izolare de restul suitei, care
 * inserează cu createdAt implicit (acum).
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { emailMessages, emailSends, emailSuppressions, emailThreads } from '../../shared/db/schema/index.js'
import { getSendsReport } from './service.js'

const WINDOW_FROM = '2020-01-01T00:00:00.000Z'
const WINDOW_TO = '2020-01-02T00:00:00.000Z'
const sendIds: string[] = []
const threadIds: string[] = []
const suppressionIds: string[] = []

afterAll(async () => {
  for (const id of sendIds) await db.delete(emailSends).where(eq(emailSends.id, id))
  for (const id of threadIds) await db.delete(emailThreads).where(eq(emailThreads.id, id))
  for (const id of suppressionIds) await db.delete(emailSuppressions).where(eq(emailSuppressions.id, id))
})

describe('getSendsReport — replied (manual sends, nu doar secvențe)', () => {
  it('numără un reply real la un send MANUAL (fără sequenceEnrollmentId)', async () => {
    // Domenii DIFERITE — matching-ul e acum și pe domeniu (2026-08-27), nu doar adresă exactă;
    // aceeași domeniu ar fi făcut silentRecipient să pară "răspuns" prin reply-ul lui repliedRecipient.
    const repliedRecipient = `replied@${randomUUID()}.example`
    const silentRecipient = `silent@${randomUUID()}.example`

    const [sendReplied] = await db
      .insert(emailSends)
      .values({
        recipient: repliedRecipient,
        subject: 'Test manual cu reply',
        status: 'delivered',
        createdAt: new Date('2020-01-01T10:00:00Z'),
      })
      .returning()
    const [sendSilent] = await db
      .insert(emailSends)
      .values({
        recipient: silentRecipient,
        subject: 'Test manual fără reply',
        status: 'delivered',
        createdAt: new Date('2020-01-01T10:00:00Z'),
      })
      .returning()
    sendIds.push(sendReplied!.id, sendSilent!.id)

    const [thread] = await db
      .insert(emailThreads)
      .values({ subject: 'Re: Test manual cu reply', participants: [repliedRecipient], lastMessageAt: new Date('2020-01-01T12:00:00Z') })
      .returning()
    threadIds.push(thread!.id)
    await db.insert(emailMessages).values({
      threadId: thread!.id,
      direction: 'in',
      fromAddress: repliedRecipient,
      toAddress: 'stefan@vanadium.systems',
      subject: 'Re: Test manual cu reply',
      receivedAt: new Date('2020-01-01T12:00:00Z'), // DUPĂ send (10:00)
    })

    const report = await getSendsReport({ from: WINDOW_FROM, to: WINDOW_TO })

    expect(report.totals.sent).toBe(2)
    expect(report.totals.replied).toBe(1)
    expect(report.totals.replyRate).toBeCloseTo(0.5)
  })

  it('nu numără un mesaj inbound PRIMIT ÎNAINTE de send (nu poate fi un reply la el)', async () => {
    const recipient = `before-${randomUUID()}@test.example`
    const [send] = await db
      .insert(emailSends)
      .values({ recipient, subject: 'Send după un email vechi', status: 'delivered', createdAt: new Date('2020-01-01T15:00:00Z') })
      .returning()
    sendIds.push(send!.id)

    const [thread] = await db
      .insert(emailThreads)
      .values({ subject: 'Email vechi', participants: [recipient], lastMessageAt: new Date('2020-01-01T09:00:00Z') })
      .returning()
    threadIds.push(thread!.id)
    await db.insert(emailMessages).values({
      threadId: thread!.id,
      direction: 'in',
      fromAddress: recipient,
      toAddress: 'stefan@vanadium.systems',
      subject: 'Email vechi',
      receivedAt: new Date('2020-01-01T09:00:00Z'), // ÎNAINTE de send (15:00)
    })

    const report = await getSendsReport({ from: '2020-01-01T14:00:00.000Z', to: '2020-01-01T16:00:00.000Z' })
    expect(report.totals.sent).toBe(1)
    expect(report.totals.replied).toBe(0)
  })

  it('numără un reply de pe ACELAȘI DOMENIU, altă adresă (2026-08-27 — exemplu real: outreach la contact@, răspuns de la o persoană din aceeași companie)', async () => {
    const domain = `${randomUUID()}.example`
    const [send] = await db
      .insert(emailSends)
      .values({ recipient: `contact@${domain}`, subject: 'Outreach', status: 'delivered', createdAt: new Date('2020-01-01T20:00:00Z') })
      .returning()
    sendIds.push(send!.id)

    const [thread] = await db
      .insert(emailThreads)
      .values({ subject: 'Re: Outreach', participants: [`persoana@${domain}`], lastMessageAt: new Date('2020-01-01T21:00:00Z') })
      .returning()
    threadIds.push(thread!.id)
    await db.insert(emailMessages).values({
      threadId: thread!.id,
      direction: 'in',
      fromAddress: `persoana@${domain}`, // altă adresă, ACELAȘI domeniu ca send-ul
      toAddress: 'outreach@vanadium.systems',
      subject: 'Re: Outreach',
      receivedAt: new Date('2020-01-01T21:00:00Z'),
    })

    const report = await getSendsReport({ from: '2020-01-01T19:00:00.000Z', to: '2020-01-01T22:00:00.000Z' })
    expect(report.totals.sent).toBe(1)
    expect(report.totals.replied).toBe(1)
  })
})

/**
 * 'unsubscribed' — bug real găsit 2026-08-27 (Stefan: „Dezabonări arată 0 când nu e 0"): un
 * self-join pe email_sends (subquery aliasat `bs`) cu o referință neambiguă la coloana
 * exterioară se auto-corela cu RÂNDUL DIN `bs` în loc de rândul exterior (Drizzle emite
 * "recipient" simplu, fără prefix de tabelă, când FROM-ul exterior n-are alias) — condiția
 * NOT EXISTS devenea mereu falsă, deci nicio dezabonare "pură" nu era numărată vreodată.
 */
describe('getSendsReport — unsubscribed (bug self-join fără alias, 2026-08-27)', () => {
  it('numără o dezabonare PURĂ (fără bounce) — nu doar bounce-uri suprimate', async () => {
    const pureRecipient = `unsub-pure-${randomUUID()}@test.example`
    const bouncedRecipient = `unsub-bounced-${randomUUID()}@test.example`

    const [sendPure] = await db
      .insert(emailSends)
      .values({ recipient: pureRecipient, subject: 'Test dezabonare pură', status: 'delivered', createdAt: new Date('2020-01-01T18:00:00Z') })
      .returning()
    const [sendBounced] = await db
      .insert(emailSends)
      .values({ recipient: bouncedRecipient, subject: 'Test dezabonare din bounce', status: 'bounced', createdAt: new Date('2020-01-01T18:00:00Z') })
      .returning()
    sendIds.push(sendPure!.id, sendBounced!.id)

    const [suppPure] = await db.insert(emailSuppressions).values({ email: pureRecipient }).returning()
    const [suppBounced] = await db.insert(emailSuppressions).values({ email: bouncedRecipient }).returning()
    suppressionIds.push(suppPure!.id, suppBounced!.id)

    const report = await getSendsReport({ from: WINDOW_FROM, to: WINDOW_TO })
    expect(report.totals.unsubscribed).toBe(1)
  })
})
