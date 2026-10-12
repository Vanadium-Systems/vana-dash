import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { emailSends, emailSuppressions, prospects } from '../../shared/db/schema/index.js'
import { getSuppressedEmails, getSuppressionsOverview, removeSuppression, suppressEmail } from './unsubscribe-service.js'

const suppressionEmails: string[] = []
const prospectIds: string[] = []
const sendIds: string[] = []

afterAll(async () => {
  if (suppressionEmails.length) await db.delete(emailSuppressions).where(inArray(emailSuppressions.email, suppressionEmails))
  if (prospectIds.length) await db.delete(prospects).where(inArray(prospects.id, prospectIds))
  if (sendIds.length) await db.delete(emailSends).where(inArray(emailSends.id, sendIds))
})

describe('suppressEmail', () => {
  it('inserts a normalized (lowercase, trimmed) suppression row', async () => {
    suppressionEmails.push('someone@example.com')
    await suppressEmail('  Someone@Example.COM  ')

    const [row] = await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, 'someone@example.com'))
    expect(row).toBeDefined()
    expect(row?.unsubscribedAt).toBeInstanceOf(Date)
  })

  it('is idempotent — clicking the link twice does not throw or duplicate', async () => {
    suppressionEmails.push('twice@example.com')
    await suppressEmail('twice@example.com')
    await expect(suppressEmail('twice@example.com')).resolves.not.toThrow()

    const rows = await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, 'twice@example.com'))
    expect(rows).toHaveLength(1)
  })

  it('also marks a matching prospect as dezabonat', async () => {
    const [prospect] = await db.insert(prospects).values({ name: 'QA Unsub Cross-Module SRL', email: 'crossmodule@example.com' }).returning()
    prospectIds.push(prospect!.id)
    suppressionEmails.push('crossmodule@example.com')

    await suppressEmail('crossmodule@example.com')

    const [row] = await db.select().from(prospects).where(and(eq(prospects.id, prospect!.id), isNull(prospects.deletedAt)))
    expect(row?.status).toBe('dezabonat')
  })

  it('does not throw when no prospect matches the email', async () => {
    suppressionEmails.push('nomatch@example.com')
    await expect(suppressEmail('nomatch@example.com')).resolves.not.toThrow()
  })

  it('defaults source to manual, and stores bounce/complaint when passed explicitly (2026-09-03)', async () => {
    suppressionEmails.push('src-manual@example.com', 'src-bounce@example.com')
    await suppressEmail('src-manual@example.com')
    await suppressEmail('src-bounce@example.com', 'bounce')

    const [manual] = await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, 'src-manual@example.com'))
    const [bounce] = await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, 'src-bounce@example.com'))
    expect(manual?.source).toBe('manual')
    expect(bounce?.source).toBe('bounce')
  })

  it('updates the source on a re-trigger (bounce after an earlier manual unsubscribe)', async () => {
    suppressionEmails.push('src-update@example.com')
    await suppressEmail('src-update@example.com', 'manual')
    await suppressEmail('src-update@example.com', 'bounce')

    const [row] = await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, 'src-update@example.com'))
    expect(row?.source).toBe('bounce')
  })
})

describe('getSuppressionsOverview (2026-09-03 — pagina Dezabonări din Setări Email)', () => {
  it('splits manual vs. auto (bounce/complaint) suppressions, and aggregates bounces per recipient from email_sends', async () => {
    const manualEmail = `manual-${randomUUID()}@example.com`
    const bounceEmail = `bounce-${randomUUID()}@example.com`
    const complaintEmail = `complaint-${randomUUID()}@example.com`
    const bouncedRecipient = `bounced-recipient-${randomUUID()}@example.com`
    suppressionEmails.push(manualEmail, bounceEmail, complaintEmail)

    await suppressEmail(manualEmail, 'manual')
    await suppressEmail(bounceEmail, 'bounce')
    await suppressEmail(complaintEmail, 'complaint')

    const bounceRows = await db
      .insert(emailSends)
      .values([
        { recipient: bouncedRecipient, subject: 'QA overview 1', status: 'bounced' },
        { recipient: bouncedRecipient, subject: 'QA overview 2', status: 'bounced' },
      ])
      .returning({ id: emailSends.id })
    sendIds.push(...bounceRows.map((r) => r.id))

    const overview = await getSuppressionsOverview()

    expect(overview.unsubscribed.some((r) => r.email === manualEmail)).toBe(true)
    expect(overview.unsubscribed.some((r) => r.email === bounceEmail)).toBe(false)
    expect(overview.autoUnsubscribed.find((r) => r.email === bounceEmail)?.source).toBe('bounce')
    expect(overview.autoUnsubscribed.find((r) => r.email === complaintEmail)?.source).toBe('complaint')
    const bouncedRow = overview.bounced.find((r) => r.recipient === bouncedRecipient)
    expect(bouncedRow?.count).toBe(2)
  })
})

describe('getSuppressedEmails', () => {
  it('returns only the suppressed addresses among the given batch', async () => {
    suppressionEmails.push('batch-suppressed@example.com')
    await suppressEmail('batch-suppressed@example.com')

    const result = await getSuppressedEmails(['batch-suppressed@example.com', 'batch-not-suppressed@example.com'])
    expect(result.has('batch-suppressed@example.com')).toBe(true)
    expect(result.has('batch-not-suppressed@example.com')).toBe(false)
  })

  it('normalizes case before matching', async () => {
    suppressionEmails.push('case-check@example.com')
    await suppressEmail('case-check@example.com')

    const result = await getSuppressedEmails(['Case-Check@Example.com'])
    expect(result.has('case-check@example.com')).toBe(true)
  })

  it('returns an empty set for an empty input without querying', async () => {
    const result = await getSuppressedEmails([])
    expect(result.size).toBe(0)
  })
})

describe('removeSuppression (2026-09-03 — buton „Scoate" din Setări Email, caz real: bounce tranzitoriu care bloca trimiterea către un contact real)', () => {
  it('removes an existing suppression, returns true, and getSuppressedEmails no longer sees it', async () => {
    const email = `qa-remove-${randomUUID()}@example.com`
    await suppressEmail(email, 'bounce')
    expect((await getSuppressedEmails([email])).has(email)).toBe(true)

    const removed = await removeSuppression(email)

    expect(removed).toBe(true)
    expect((await getSuppressedEmails([email])).has(email)).toBe(false)
  })

  it('normalizes case/whitespace before deleting', async () => {
    const email = `qa-remove-case-${randomUUID()}@example.com`
    await suppressEmail(email)

    const removed = await removeSuppression(`  ${email.toUpperCase()}  `)

    expect(removed).toBe(true)
  })

  it('returns false for an address not in the list', async () => {
    expect(await removeSuppression(`qa-remove-nomatch-${randomUUID()}@example.com`)).toBe(false)
  })
})
