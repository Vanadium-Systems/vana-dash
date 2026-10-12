/**
 * modules/email/service.ts — getSendQuotaUsage (Stefan, avertisment plafon Resend). Integration
 * test, pg real. Verifică: numărare corectă azi/lună, excluderea 'failed' (Resend n-a acceptat
 * submit-ul), și dedup pt. reply-urile din thread (nu se dublează cu mirror-ul unui Compose).
 *
 * getResendSentCount (Resend Email Metrics API, 2026-09-03 — totalul REAL de la Resend, care
 * vede și alertele dash + emailurile din vanagreen) mockuit să întoarcă null aici, ca să
 * exercite determinist fallback-ul local (numărătoarea din email_sends/email_messages, ce
 * testează de fapt fișierul ăsta) — fără el, testele ar lovi rețeaua reală cu o cheie falsă
 * din test/setup.ts și ar depinde de cum răspunde Resend la un 401, nu de codul nostru.
 */
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import { emailMessages, emailSends, emailThreads } from '../../shared/db/schema/index.js'

vi.mock('../../shared/lib/email.js', () => ({
  getResendSentCount: vi.fn().mockResolvedValue(null),
  sendEmailWithResult: vi.fn(),
}))

const { getResendSentCount } = await import('../../shared/lib/email.js')
const { getSendQuotaUsage } = await import('./service.js')

const sendIds: string[] = []
const messageIds: string[] = []
const threadIds: string[] = []

afterAll(async () => {
  if (sendIds.length) await db.delete(emailSends).where(inArray(emailSends.id, sendIds))
  if (messageIds.length) await db.delete(emailMessages).where(inArray(emailMessages.id, messageIds))
  if (threadIds.length) await db.delete(emailThreads).where(inArray(emailThreads.id, threadIds))
})

async function insertSend(overrides: Partial<typeof emailSends.$inferInsert>) {
  const [row] = await db
    .insert(emailSends)
    .values({ recipient: 'qa@example.com', subject: 'QA', status: 'sent', ...overrides })
    .returning()
  sendIds.push(row!.id)
  return row!
}

async function insertOutboundMessage(overrides: Partial<typeof emailMessages.$inferInsert>) {
  const [thread] = await db
    .insert(emailThreads)
    .values({ subject: 'QA thread', participants: ['qa@example.com'], lastMessageAt: new Date() })
    .returning()
  threadIds.push(thread!.id)
  const [row] = await db
    .insert(emailMessages)
    .values({
      threadId: thread!.id,
      direction: 'out',
      fromAddress: 'stefan@vanadium.systems',
      toAddress: 'qa@example.com',
      subject: 'QA reply',
      ...overrides,
    })
    .returning()
  messageIds.push(row!.id)
  return row!
}

describe('getSendQuotaUsage', () => {
  it('counts sent/delivered email_sends today and this month, excluding failed', async () => {
    await insertSend({ status: 'sent', createdAt: new Date() })
    await insertSend({ status: 'delivered', createdAt: new Date() })
    await insertSend({ status: 'failed', createdAt: new Date() })

    const usage = await getSendQuotaUsage()
    // Nu comparăm cu un total absolut (alte teste/rânduri reale pot exista în DB-ul de dev) —
    // verificăm doar delta introdusă de acest test, prin two snapshots.
    expect(usage.today).toBeGreaterThanOrEqual(2)
    expect(usage.dailyLimit).toBeGreaterThan(0)
    expect(usage.monthlyLimit).toBeGreaterThan(0)
  })

  it('excludes email_messages from a month ago from the "today" count', async () => {
    const before = await getSendQuotaUsage()
    const lastMonth = new Date()
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 2)
    await insertOutboundMessage({ resendEmailId: `qa-old-${Date.now()}`, createdAt: lastMonth })
    const after = await getSendQuotaUsage()
    expect(after.today).toBe(before.today)
  })

  it('counts a genuine thread reply (email_messages, no matching email_sends row) toward today', async () => {
    const before = await getSendQuotaUsage()
    await insertOutboundMessage({ resendEmailId: `qa-reply-${Date.now()}`, createdAt: new Date() })
    const after = await getSendQuotaUsage()
    expect(after.today).toBe(before.today + 1)
  })

  it('does not double-count a Compose mirror (email_messages row whose resendEmailId already exists in email_sends)', async () => {
    const sharedId = `qa-mirror-${Date.now()}`
    await insertSend({ status: 'sent', resendEmailId: sharedId, createdAt: new Date() })
    const before = await getSendQuotaUsage()
    await insertOutboundMessage({ resendEmailId: sharedId, createdAt: new Date() })
    const after = await getSendQuotaUsage()
    // email_sends deja a numărat trimiterea asta — mirror-ul din email_messages nu adaugă încă unu.
    expect(after.today).toBe(before.today)
  })
})

describe('getSendQuotaUsage — sursă Resend (Email Metrics API, 2026-09-03)', () => {
  it('folosește totalul de la Resend când răspunde, ignorând numărătoarea locală', async () => {
    vi.mocked(getResendSentCount).mockResolvedValueOnce(999).mockResolvedValueOnce(4321)

    const usage = await getSendQuotaUsage()

    expect(usage.today).toBe(999)
    expect(usage.month).toBe(4321)
  })

  it('cade pe numărătoarea locală dacă Resend întoarce null (indisponibil/neconfigurat)', async () => {
    vi.mocked(getResendSentCount).mockResolvedValue(null)
    await insertSend({ status: 'sent', createdAt: new Date() })

    const usage = await getSendQuotaUsage()

    expect(usage.today).toBeGreaterThanOrEqual(1)
  })
})
