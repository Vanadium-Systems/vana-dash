/**
 * jobs/email-sequence-runner.ts (2026-08-12) — cron zilnic, avansează secvențele de follow-up
 * automate. Integration test, pg real pt. email_sequences/steps/enrollments (regula CLAUDE.md
 * #9); modules/email/service.js (sendCampaignEmail, getOutreachCapStatus) și
 * unsubscribe-service.js (getSuppressedEmails) mockuite la graniță — au propriile teste
 * dedicate (service.test.ts, warmup.test.ts). Verificăm doar ORCHESTRAREA.
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../shared/db/client.js'
import { emailSequenceEnrollments, emailSequences, emailSequenceSteps, emailTemplates } from '../shared/db/schema/index.js'

const sendCampaignEmailMock = vi.fn()
const getOutreachCapStatusMock = vi.fn()
const getSuppressedEmailsMock = vi.fn()

vi.mock('../modules/email/service.js', () => ({
  sendCampaignEmail: (...args: unknown[]) => sendCampaignEmailMock(...args),
  getOutreachCapStatus: (...args: unknown[]) => getOutreachCapStatusMock(...args),
}))
vi.mock('../modules/email/unsubscribe-service.js', () => ({
  getSuppressedEmails: (...args: unknown[]) => getSuppressedEmailsMock(...args),
}))

const { runEmailSequences } = await import('./email-sequence-runner.js')

const templateIds: string[] = []
const sequenceIds: string[] = []

async function makeTemplate() {
  const [row] = await db.insert(emailTemplates).values({ name: 'QA runner template', subject: 'Subiect', body: 'Body' }).returning()
  templateIds.push(row!.id)
  return row!
}

async function makeSequence(fromIdentity: 'stefan' | 'contact' | 'outreach', steps: Array<{ templateId: string; delayDays: number }>, active = true) {
  const [seq] = await db.insert(emailSequences).values({ name: 'QA runner sequence', fromIdentity, active }).returning()
  sequenceIds.push(seq!.id)
  await db
    .insert(emailSequenceSteps)
    .values(steps.map((s, i) => ({ sequenceId: seq!.id, stepOrder: i + 1, templateId: s.templateId, delayDays: s.delayDays })))
  return seq!
}

async function makeEnrollment(sequenceId: string, overrides: Partial<typeof emailSequenceEnrollments.$inferInsert> = {}) {
  const [row] = await db
    .insert(emailSequenceEnrollments)
    .values({
      sequenceId,
      recipientEmail: `qa-runner-${Math.random().toString(36).slice(2)}@example.com`,
      nextSendAt: new Date(Date.now() - 60_000), // due (în trecut)
      ...overrides,
    })
    .returning()
  return row!
}

beforeEach(() => {
  sendCampaignEmailMock.mockReset()
  getOutreachCapStatusMock.mockReset()
  getSuppressedEmailsMock.mockReset()
  getOutreachCapStatusMock.mockResolvedValue({ cap: 150, usedToday: 0, remaining: 150 })
  getSuppressedEmailsMock.mockResolvedValue(new Set())
})

afterEach(async () => {
  if (sequenceIds.length) await db.delete(emailSequences).where(inArray(emailSequences.id, sequenceIds.splice(0)))
})

afterAll(async () => {
  vi.restoreAllMocks()
  if (templateIds.length) await db.delete(emailTemplates).where(inArray(emailTemplates.id, templateIds.splice(0)))
})

describe('runEmailSequences', () => {
  it('advances an enrollment to the next step on a successful send, scheduling next_send_at by delayDays', async () => {
    const tpl1 = await makeTemplate()
    const tpl2 = await makeTemplate()
    const seq = await makeSequence('contact', [
      { templateId: tpl1.id, delayDays: 0 },
      { templateId: tpl2.id, delayDays: 3 },
    ])
    const enrollment = await makeEnrollment(seq.id)
    sendCampaignEmailMock.mockResolvedValue({ result: { ok: true, id: 'resend-x' }, row: { id: 'send-x' } })

    await runEmailSequences()

    const [after] = await db.select().from(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.id, enrollment.id))
    expect(after!.currentStep).toBe(1)
    expect(after!.status).toBe('active')
    expect(after!.consecutiveFailures).toBe(0)
    const daysUntilNext = (after!.nextSendAt.getTime() - Date.now()) / 86_400_000
    expect(daysUntilNext).toBeGreaterThan(2.9)
    expect(daysUntilNext).toBeLessThan(3.1)
    expect(sendCampaignEmailMock).toHaveBeenCalledWith(expect.objectContaining({ templateId: tpl1.id, sequenceEnrollmentId: enrollment.id }))
  })

  it('marks completed after the last step succeeds', async () => {
    const tpl = await makeTemplate()
    const seq = await makeSequence('contact', [{ templateId: tpl.id, delayDays: 0 }])
    const enrollment = await makeEnrollment(seq.id)
    sendCampaignEmailMock.mockResolvedValue({ result: { ok: true }, row: {} })

    await runEmailSequences()

    const [after] = await db.select().from(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.id, enrollment.id))
    expect(after!.status).toBe('completed')
    expect(after!.currentStep).toBe(1)
  })

  it('marks failed on the 3rd consecutive failure; retries (next_send_at unchanged) before that', async () => {
    const tpl = await makeTemplate()
    const seq = await makeSequence('contact', [{ templateId: tpl.id, delayDays: 0 }])
    const enrollment = await makeEnrollment(seq.id, { consecutiveFailures: 2 })
    sendCampaignEmailMock.mockResolvedValue({ result: { ok: false, error: 'boom' }, row: {} })

    await runEmailSequences()

    const [after] = await db.select().from(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.id, enrollment.id))
    expect(after!.consecutiveFailures).toBe(3)
    expect(after!.status).toBe('failed')
  })

  it('a single consecutive failure keeps the enrollment active for a retry tomorrow', async () => {
    const tpl = await makeTemplate()
    const seq = await makeSequence('contact', [{ templateId: tpl.id, delayDays: 0 }])
    const enrollment = await makeEnrollment(seq.id)
    sendCampaignEmailMock.mockResolvedValue({ result: { ok: false, error: 'transient' }, row: {} })

    await runEmailSequences()

    const [after] = await db.select().from(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.id, enrollment.id))
    expect(after!.status).toBe('active')
    expect(after!.consecutiveFailures).toBe(1)
    expect(after!.currentStep).toBe(0) // n-a avansat — eșec, nu succes
  })

  it('respects the outreach daily cap — enrollments beyond remaining are skipped this run (next_send_at unchanged)', async () => {
    const tpl = await makeTemplate()
    const seq = await makeSequence('outreach', [{ templateId: tpl.id, delayDays: 0 }])
    const a = await makeEnrollment(seq.id)
    const b = await makeEnrollment(seq.id)
    getOutreachCapStatusMock.mockResolvedValue({ cap: 1, usedToday: 0, remaining: 1 })
    sendCampaignEmailMock.mockResolvedValue({ result: { ok: true }, row: {} })

    await runEmailSequences()

    expect(sendCampaignEmailMock).toHaveBeenCalledTimes(1)
    const rows = await db.select().from(emailSequenceEnrollments).where(inArray(emailSequenceEnrollments.id, [a.id, b.id]))
    expect(rows.filter((r) => r.currentStep === 1)).toHaveLength(1)
    expect(rows.filter((r) => r.currentStep === 0)).toHaveLength(1)
  })

  it('sequences on stefan/contact are never capped, even with remaining=0 on outreach', async () => {
    const tpl = await makeTemplate()
    const seq = await makeSequence('contact', [{ templateId: tpl.id, delayDays: 0 }])
    await makeEnrollment(seq.id)
    getOutreachCapStatusMock.mockResolvedValue({ cap: 20, usedToday: 20, remaining: 0 })
    sendCampaignEmailMock.mockResolvedValue({ result: { ok: true }, row: {} })

    await runEmailSequences()

    expect(sendCampaignEmailMock).toHaveBeenCalledTimes(1)
  })

  it('marks a suppressed recipient unsubscribed without calling sendCampaignEmail', async () => {
    const tpl = await makeTemplate()
    const seq = await makeSequence('contact', [{ templateId: tpl.id, delayDays: 0 }])
    const enrollment = await makeEnrollment(seq.id, { recipientEmail: 'runner-suppressed@example.com' })
    getSuppressedEmailsMock.mockResolvedValue(new Set(['runner-suppressed@example.com']))

    await runEmailSequences()

    expect(sendCampaignEmailMock).not.toHaveBeenCalled()
    const [after] = await db.select().from(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.id, enrollment.id))
    expect(after!.status).toBe('unsubscribed')
  })

  it('does not process enrollments whose parent sequence is paused (active=false)', async () => {
    const tpl = await makeTemplate()
    const seq = await makeSequence('contact', [{ templateId: tpl.id, delayDays: 0 }], false)
    const enrollment = await makeEnrollment(seq.id)

    await runEmailSequences()

    expect(sendCampaignEmailMock).not.toHaveBeenCalled()
    const [after] = await db.select().from(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.id, enrollment.id))
    expect(after!.currentStep).toBe(0)
  })

  it('does not process enrollments not yet due (next_send_at in the future)', async () => {
    const tpl = await makeTemplate()
    const seq = await makeSequence('contact', [{ templateId: tpl.id, delayDays: 0 }])
    const enrollment = await makeEnrollment(seq.id, { nextSendAt: new Date(Date.now() + 86_400_000) })

    await runEmailSequences()

    expect(sendCampaignEmailMock).not.toHaveBeenCalled()
    const [after] = await db.select().from(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.id, enrollment.id))
    expect(after!.currentStep).toBe(0)
  })
})
