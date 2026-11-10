/**
 * Sequences across channels (2026-11): email / call steps, A/B variants, stop rules, bounce
 * vs unsubscribe, the bounce-rate pause and the diagnostics. Postgres real; Resend is mocked at
 * module level (sendEmailWithResult) so nothing leaves, and the real sendCampaignEmail and
 * assertCanDeliver run in front of it.
 */
import { randomUUID } from 'node:crypto'
import { eq, inArray, like } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from '../shared/db/client.js'
import {
  emailSends,
  emailSequenceEnrollments,
  emailSequences,
  emailSequenceSteps,
  emailSuppressions,
  emailTemplates,
  notifications,
  prospectContactPoints,
  prospectListMembers,
  prospectLists,
  prospectPeople,
  prospects,
  prospectTasks,
  roles,
  users,
} from '../shared/db/schema/index.js'
import type { SendEmailResult } from '../shared/lib/email.js'
import { emitProspectEvent, onProspectEvent } from '../shared/lib/prospect-events.js'
import { effectiveFeatures, type SessionUser } from '../shared/lib/session.js'

const sendEmailWithResultMock = vi.fn<(args: { to: string }) => Promise<SendEmailResult>>()
vi.mock('../shared/lib/email.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/lib/email.js')>()
  return { ...actual, sendEmailWithResult: sendEmailWithResultMock, fetchReceivedEmail: async () => null }
})

const { pickVariant, registerSequenceListeners, runEmailSequences } = await import('./email-sequence-runner.js')
const { enrollRecipients, getSequenceDiagnostics, pauseSequenceIfBouncing, updateSequence } = await import('../modules/email/sequences-service.js')
const { updateSendStatusFromWebhook } = await import('../modules/email/service.js')
const { suppressEmail } = await import('../modules/email/unsubscribe-service.js')
const { completeTask } = await import('../modules/prospects/crm-service.js')

registerSequenceListeners()

const RUN = randomUUID().slice(0, 8)
const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const [adminUser] = await db.select({ id: users.id }).from(users).where(eq(users.roleId, adminRole!.id)).limit(1)

const admin = {
  id: adminUser!.id,
  email: 'qa-seq-runner@test.local',
  displayName: 'QA',
  role: { id: adminRole!.id, name: 'Admin', kind: 'admin' },
  isPlatformAdmin: false,
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

const templateIds: string[] = []
const sequenceIds: string[] = []
const prospectIds: string[] = []
const listIds: string[] = []
const addresses: string[] = []

beforeAll(() => {
  sendEmailWithResultMock.mockImplementation(async () => ({ ok: true, id: `resend-${randomUUID()}` }))
})

afterEach(async () => {
  sendEmailWithResultMock.mockClear()
  if (sequenceIds.length) {
    await db.delete(notifications).where(inArray(notifications.entityId, sequenceIds))
    await db.delete(emailSequences).where(inArray(emailSequences.id, sequenceIds.splice(0)))
  }
  if (listIds.length) await db.delete(prospectLists).where(inArray(prospectLists.id, listIds.splice(0)))
  if (prospectIds.length) {
    await db.delete(prospectTasks).where(inArray(prospectTasks.prospectId, prospectIds))
    await db.delete(prospects).where(inArray(prospects.id, prospectIds.splice(0)))
  }
  if (addresses.length) {
    await db.delete(emailSends).where(inArray(emailSends.recipient, addresses))
    await db.delete(emailSuppressions).where(inArray(emailSuppressions.email, addresses.splice(0)))
  }
})

afterAll(async () => {
  await db.delete(emailSends).where(like(emailSends.recipient, `%-${RUN}@example.com`))
  if (templateIds.length) await db.delete(emailTemplates).where(inArray(emailTemplates.id, templateIds.splice(0)))
})

const address = (label: string) => {
  const value = `${label}-${RUN}@example.com`
  addresses.push(value)
  return value
}

async function makeTemplate(name = 'QA seq') {
  const [row] = await db.insert(emailTemplates).values({ name, subject: `${name} {{nume}}`, body: '<p>Salut</p>' }).returning()
  templateIds.push(row!.id)
  return row!
}

type StepSpec = { kind?: 'email' | 'call' | 'task'; delayDays: number; templateId?: string; variantBTemplateId?: string; taskTitle?: string }

async function makeSequence(steps: StepSpec[], overrides: Partial<typeof emailSequences.$inferInsert> = {}) {
  const [seq] = await db.insert(emailSequences).values({ name: 'QA seq', fromIdentity: 'contact', ...overrides }).returning()
  sequenceIds.push(seq!.id)
  const stepRows = await db
    .insert(emailSequenceSteps)
    .values(steps.map((s, i) => ({ sequenceId: seq!.id, stepOrder: i + 1, kind: s.kind ?? 'email', delayDays: s.delayDays, templateId: s.templateId, variantBTemplateId: s.variantBTemplateId, taskTitle: s.taskTitle })))
    .returning()
  return { seq: seq!, steps: stepRows.sort((a, b) => a.stepOrder - b.stepOrder) }
}

async function makeProspect(name = 'QA Firma SRL', extra: Partial<typeof prospects.$inferInsert> = {}) {
  const [row] = await db.insert(prospects).values({ name, ...extra }).returning()
  prospectIds.push(row!.id)
  return row!
}

async function addPoint(prospectId: string, kind: 'email' | 'phone', value: string, extra: Partial<typeof prospectContactPoints.$inferInsert> = {}) {
  const [row] = await db.insert(prospectContactPoints).values({ prospectId, kind, value, valueNormalized: value.toLowerCase(), ...extra }).returning()
  return row!
}

async function enroll(sequenceId: string, prospectId: string | null, recipientEmail: string, overrides: Partial<typeof emailSequenceEnrollments.$inferInsert> = {}) {
  const [row] = await db
    .insert(emailSequenceEnrollments)
    .values({ sequenceId, prospectId, recipientEmail, recipientName: 'Ana', nextSendAt: new Date(Date.now() - 60_000), ...overrides })
    .returning()
  return row!
}

const reload = async (id: string) => (await db.select().from(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.id, id)))[0]!
const makeDue = (id: string) => db.update(emailSequenceEnrollments).set({ nextSendAt: new Date(Date.now() - 60_000) }).where(eq(emailSequenceEnrollments.id, id))
const daysFromNow = (d: Date) => (d.getTime() - Date.now()) / 86_400_000

describe('email, call, email', () => {
  it('sends step 1, makes the call task at step 2 and waits, then schedules step 3 when the task is done', async () => {
    const [t1, t2] = [await makeTemplate(), await makeTemplate()]
    const { seq } = await makeSequence([
      { templateId: t1.id, delayDays: 0 },
      { kind: 'call', delayDays: 2, taskTitle: 'Sună {{firma}} ({{nume}})' },
      { templateId: t2.id, delayDays: 3 },
    ])
    const prospect = await makeProspect('Acme SRL', { assignedUserId: admin.id })
    const to = address('flow')
    await addPoint(prospect.id, 'email', to)
    const enrollment = await enroll(seq.id, prospect.id, to)

    await runEmailSequences()
    expect(sendEmailWithResultMock).toHaveBeenCalledTimes(1)
    expect(sendEmailWithResultMock.mock.calls[0]![0].to).toBe(to)
    let row = await reload(enrollment.id)
    expect(row.currentStep).toBe(1)
    expect(daysFromNow(row.nextSendAt)).toBeGreaterThan(1.9)

    await makeDue(enrollment.id)
    await runEmailSequences()
    row = await reload(enrollment.id)
    expect(row.currentStep).toBe(2)
    expect(row.waitingTaskId).not.toBeNull()
    expect(sendEmailWithResultMock).toHaveBeenCalledTimes(1)
    const [task] = await db.select().from(prospectTasks).where(eq(prospectTasks.id, row.waitingTaskId!))
    expect(task).toMatchObject({ kind: 'call', title: 'Sună Acme SRL (Ana)', assigneeUserId: admin.id, prospectId: prospect.id })

    // Waiting: even when nextSendAt is in the past, nothing happens.
    await makeDue(enrollment.id)
    await runEmailSequences()
    expect(sendEmailWithResultMock).toHaveBeenCalledTimes(1)
    expect((await reload(enrollment.id)).currentStep).toBe(2)

    await completeTask(admin, task!.id, {})
    await vi.waitFor(async () => expect((await reload(enrollment.id)).waitingTaskId).toBeNull())
    row = await reload(enrollment.id)
    expect(row.status).toBe('active')
    expect(daysFromNow(row.nextSendAt)).toBeGreaterThan(2.9)
    expect(daysFromNow(row.nextSendAt)).toBeLessThan(3.1)

    await makeDue(enrollment.id)
    await runEmailSequences()
    expect(sendEmailWithResultMock).toHaveBeenCalledTimes(2)
    expect((await reload(enrollment.id)).status).toBe('completed')
  })

  it('skips a task left open for more than 7 days and moves on', async () => {
    const t = await makeTemplate()
    const { seq } = await makeSequence([
      { kind: 'task', delayDays: 0, taskTitle: 'Verifică {{firma}}' },
      { templateId: t.id, delayDays: 4 },
    ])
    const prospect = await makeProspect('Beta SRL', { assignedUserId: admin.id })
    const enrollment = await enroll(seq.id, prospect.id, address('stale'))

    await runEmailSequences()
    const waiting = (await reload(enrollment.id)).waitingTaskId!
    expect(waiting).toBeTruthy()

    await db.update(prospectTasks).set({ createdAt: new Date(Date.now() - 8 * 86_400_000) }).where(eq(prospectTasks.id, waiting))
    await runEmailSequences()

    const [task] = await db.select().from(prospectTasks).where(eq(prospectTasks.id, waiting))
    expect(task!.skippedAt).not.toBeNull()
    const row = await reload(enrollment.id)
    expect(row.waitingTaskId).toBeNull()
    expect(daysFromNow(row.nextSendAt)).toBeGreaterThan(3.9)
  })

  it('without a prospect a non-email step is skipped, and an address-less enrollment is never emailed', async () => {
    const t = await makeTemplate()
    const { seq } = await makeSequence([
      { kind: 'call', delayDays: 0, taskTitle: 'Sună' },
      { templateId: t.id, delayDays: 0 },
    ])
    const free = await enroll(seq.id, null, address('free'))
    const prospect = await makeProspect()
    const placeholder = await enroll(seq.id, prospect.id, `prospect:${prospect.id}@invalid`, { currentStep: 1 })

    await runEmailSequences()
    expect((await reload(free.id)).currentStep).toBe(1)
    expect((await reload(placeholder.id)).status).toBe('completed')
    expect(sendEmailWithResultMock).not.toHaveBeenCalledWith(expect.objectContaining({ to: expect.stringContaining('@invalid') }))
  })
})

describe('A/B variants', () => {
  it('is deterministic and splits about half and half', () => {
    expect(pickVariant('enrollment-1', 'step-1')).toBe(pickVariant('enrollment-1', 'step-1'))
    let a = 0
    for (let i = 0; i < 1000; i++) if (pickVariant(randomUUID(), 'step-1') === 'A') a++
    expect(a).toBeGreaterThanOrEqual(450)
    expect(a).toBeLessThanOrEqual(550)
  })

  it('sends the template of the chosen variant and records step and variant on the send', async () => {
    const [ta, tb] = [await makeTemplate('Varianta A'), await makeTemplate('Varianta B')]
    const { seq, steps } = await makeSequence([{ templateId: ta.id, variantBTemplateId: tb.id, delayDays: 0 }])
    const enrollment = await enroll(seq.id, null, address('ab'))

    await runEmailSequences()

    const variant = pickVariant(enrollment.id, steps[0]!.id)
    const [send] = await db.select().from(emailSends).where(eq(emailSends.sequenceEnrollmentId, enrollment.id))
    expect(send).toMatchObject({ variant, sequenceStepId: steps[0]!.id, templateId: variant === 'A' ? ta.id : tb.id, kind: 'sequence' })
  })
})

describe('stop rules', () => {
  it('stops on a won stage and on a booked meeting, only in sequences that ask for it', async () => {
    const t = await makeTemplate()
    const stops = await makeSequence([{ templateId: t.id, delayDays: 5 }])
    const keeps = await makeSequence([{ templateId: t.id, delayDays: 5 }], { stopOnWonLost: false, stopOnMeeting: false })
    const prospect = await makeProspect()
    const a = await enroll(stops.seq.id, prospect.id, address('stop-a'))
    const b = await enroll(keeps.seq.id, prospect.id, address('stop-b'))

    emitProspectEvent('prospect.stage_changed', { prospectId: prospect.id, from: 'new', to: 'won', kind: 'won' })
    await vi.waitFor(async () => expect((await reload(a.id)).status).toBe('won_lost'))
    expect((await reload(b.id)).status).toBe('active')

    const meeting = await enroll(stops.seq.id, prospect.id, address('stop-c'))
    emitProspectEvent('prospect.stage_changed', { prospectId: prospect.id, from: 'won', to: 'open', kind: 'open' })
    emitProspectEvent('meeting.booked', { prospectId: prospect.id, at: new Date() })
    await vi.waitFor(async () => expect((await reload(meeting.id)).status).toBe('meeting'))
    expect((await reload(b.id)).status).toBe('active')
  })

  it('a paused sequence processes nothing; resuming brings it back', async () => {
    const t = await makeTemplate()
    const { seq } = await makeSequence([{ templateId: t.id, delayDays: 0 }], { pausedAt: new Date(), pausedReason: 'BOUNCE_RATE:0.080:50' })
    const enrollment = await enroll(seq.id, null, address('paused'))

    await runEmailSequences()
    expect(sendEmailWithResultMock).not.toHaveBeenCalled()
    expect((await reload(enrollment.id)).currentStep).toBe(0)

    await updateSequence(admin, seq.id, { paused: false })
    const [resumed] = await db.select().from(emailSequences).where(eq(emailSequences.id, seq.id))
    expect(resumed).toMatchObject({ pausedAt: null, pausedReason: null })
    await runEmailSequences()
    expect(sendEmailWithResultMock).toHaveBeenCalledTimes(1)
  })

  it('email steps wait for the send window, task steps do not', async () => {
    const t = await makeTemplate()
    const mail = await makeSequence([{ templateId: t.id, delayDays: 0 }])
    const call = await makeSequence([{ kind: 'call', delayDays: 0, taskTitle: 'Sună' }])
    const prospect = await makeProspect('Gamma', { assignedUserId: admin.id })
    const mailEnrollment = await enroll(mail.seq.id, null, address('window'))
    const callEnrollment = await enroll(call.seq.id, prospect.id, address('window-call'))

    await runEmailSequences({ inWindow: false })
    expect(sendEmailWithResultMock).not.toHaveBeenCalled()
    expect((await reload(mailEnrollment.id)).currentStep).toBe(0)
    expect((await reload(callEnrollment.id)).waitingTaskId).not.toBeNull()
  })
})

describe('bounce is not an unsubscribe', () => {
  it('marks the point bounced, stops the enrollments, keeps the prospect status and still suppresses the address', async () => {
    const t = await makeTemplate()
    const { seq } = await makeSequence([{ templateId: t.id, delayDays: 5 }])
    const prospect = await makeProspect()
    const to = address('bounce')
    const point = await addPoint(prospect.id, 'email', to)
    const enrollment = await enroll(seq.id, prospect.id, to)
    await db.insert(emailSends).values({ recipient: to, subject: 'x', status: 'sent', resendEmailId: `rb-${RUN}`, sequenceEnrollmentId: enrollment.id, kind: 'sequence' })
    const events: string[] = []
    const off = onProspectEvent('email.bounced', ({ address: a }) => void events.push(a))

    try {
      await updateSendStatusFromWebhook(`rb-${RUN}`, 'bounced', 'Mailbox does not exist')
      await vi.waitFor(() => expect(events).toEqual([to]))
    } finally {
      off()
    }

    const [after] = await db.select().from(prospectContactPoints).where(eq(prospectContactPoints.id, point.id))
    expect(after!.status).toBe('bounced')
    expect((await reload(enrollment.id)).status).toBe('bounced')
    const [row] = await db.select().from(prospects).where(eq(prospects.id, prospect.id))
    expect(row!.status).toBe(prospect.status)
    const [suppression] = await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, to))
    expect(suppression!.source).toBe('bounce')
  })

  it('an unsubscribe marks the point unsubscribed and stops the enrollments at once', async () => {
    const t = await makeTemplate()
    const { seq } = await makeSequence([{ templateId: t.id, delayDays: 5 }])
    const prospect = await makeProspect()
    const to = address('unsub')
    const point = await addPoint(prospect.id, 'email', to)
    const enrollment = await enroll(seq.id, prospect.id, to)

    await suppressEmail(to)

    const [after] = await db.select().from(prospectContactPoints).where(eq(prospectContactPoints.id, point.id))
    expect(after!.status).toBe('unsubscribed')
    expect((await reload(enrollment.id)).status).toBe('unsubscribed')
  })
})

describe('bounce-rate pause', () => {
  async function seedSends(enrollmentId: string, recipient: string, delivered: number, bounced: number) {
    const rows = [
      ...Array.from({ length: delivered }, () => ({ recipient, subject: 'x', status: 'delivered' as const, sequenceEnrollmentId: enrollmentId, kind: 'sequence' as const })),
      ...Array.from({ length: bounced }, () => ({ recipient, subject: 'x', status: 'bounced' as const, sequenceEnrollmentId: enrollmentId, kind: 'sequence' as const })),
    ]
    await db.insert(emailSends).values(rows)
  }

  it('pauses above the threshold over the last 50 sends and tells the admins', async () => {
    const t = await makeTemplate()
    const { seq } = await makeSequence([{ templateId: t.id, delayDays: 5 }])
    const to = address('rate')
    const enrollment = await enroll(seq.id, null, to)
    await seedSends(enrollment.id, to, 46, 3)
    await db.insert(emailSends).values({ recipient: to, subject: 'x', status: 'sent', resendEmailId: `rate-${RUN}`, sequenceEnrollmentId: enrollment.id, kind: 'sequence' })

    await updateSendStatusFromWebhook(`rate-${RUN}`, 'bounced', null)

    const [paused] = await db.select().from(emailSequences).where(eq(emailSequences.id, seq.id))
    expect(paused!.pausedAt).not.toBeNull()
    expect(paused!.pausedReason).toBe('BOUNCE_RATE:0.080:50')
    const alerts = await db.select().from(notifications).where(eq(notifications.entityId, seq.id))
    expect(alerts.length).toBeGreaterThan(0)
    // Already paused: a further bounce does not pause (or notify) again.
    expect(await pauseSequenceIfBouncing(enrollment.id)).toBe(false)
  })

  it('does not pause under 20 sends, however high the rate', async () => {
    const t = await makeTemplate()
    const { seq } = await makeSequence([{ templateId: t.id, delayDays: 5 }])
    const to = address('few')
    const enrollment = await enroll(seq.id, null, to)
    await seedSends(enrollment.id, to, 0, 10)

    expect(await pauseSequenceIfBouncing(enrollment.id)).toBe(false)
    const [row] = await db.select().from(emailSequences).where(eq(emailSequences.id, seq.id))
    expect(row!.pausedAt).toBeNull()
  })
})

describe('enrollment eligibility', () => {
  it('skips suppressed, bounced, unsubscribed and do-not-contact prospects and reports why', async () => {
    const t = await makeTemplate()
    const { seq } = await makeSequence([{ templateId: t.id, delayDays: 0 }])
    const ok = await makeProspect('Ok')
    const bounced = await makeProspect('Bounced')
    const unsubscribed = await makeProspect('Unsub')
    const dnc = await makeProspect('Dnc')
    const noEmail = await makeProspect('NoEmail')
    const okAddress = address('el-ok')
    await addPoint(ok.id, 'email', okAddress)
    await addPoint(bounced.id, 'email', address('el-bounced'), { status: 'bounced' })
    await addPoint(unsubscribed.id, 'email', address('el-unsub'), { status: 'unsubscribed' })
    const [person] = await db.insert(prospectPeople).values({ prospectId: dnc.id, name: 'Nu suna', doNotContact: true }).returning()
    await addPoint(dnc.id, 'email', address('el-dnc'), { personId: person!.id })
    const suppressedAddress = address('el-suppressed')
    await db.insert(emailSuppressions).values({ email: suppressedAddress, source: 'manual' })

    const result = await enrollRecipients(seq.id, [{ email: suppressedAddress, nume: 'S' }], {
      me: admin,
      prospectIds: [ok.id, bounced.id, unsubscribed.id, dnc.id, noEmail.id],
    })

    expect(result.enrolled).toBe(1)
    const reasons = Object.fromEntries(result.skipped.map((s) => [s.prospectId ?? s.recipient, s.reason]))
    expect(reasons).toEqual({
      [bounced.id]: 'BOUNCED',
      [unsubscribed.id]: 'UNSUBSCRIBED',
      [dnc.id]: 'DO_NOT_CONTACT',
      [noEmail.id]: 'NO_EMAIL',
      [suppressedAddress]: 'SUPPRESSED',
    })
    const [row] = await db.select().from(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.sequenceId, seq.id))
    expect(row).toMatchObject({ prospectId: ok.id, recipientEmail: okAddress })

    const again = await enrollRecipients(seq.id, undefined, { me: admin, prospectIds: [ok.id] })
    expect(again.skipped).toEqual([{ recipient: okAddress, prospectId: ok.id, reason: 'ALREADY_ENROLLED' }])
  })

  it('a call first step needs a phone that is not invalid; the email is optional and gets a placeholder', async () => {
    const { seq } = await makeSequence([{ kind: 'call', delayDays: 0, taskTitle: 'Sună' }])
    const withPhone = await makeProspect('Phone')
    const badPhone = await makeProspect('BadPhone')
    const none = await makeProspect('None')
    await addPoint(withPhone.id, 'phone', '+40700000001')
    await addPoint(badPhone.id, 'phone', '+40700000002', { status: 'invalid' })

    const result = await enrollRecipients(seq.id, undefined, { me: admin, prospectIds: [withPhone.id, badPhone.id, none.id] })

    expect(result.enrolled).toBe(1)
    expect(result.skipped.map((s) => [s.prospectId, s.reason]).sort()).toEqual([[badPhone.id, 'NO_PHONE'], [none.id, 'NO_PHONE']].sort())
    const [row] = await db.select().from(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.sequenceId, seq.id))
    expect(row!.recipientEmail).toBe(`prospect:${withPhone.id}@invalid`)
  })

  it('a list enrolls only the members the person can see', async () => {
    const t = await makeTemplate()
    const { seq } = await makeSequence([{ templateId: t.id, delayDays: 0 }])
    const free = await makeProspect('Free')
    const mine = await makeProspect('Mine')
    const theirs = await makeProspect('Theirs', { assignedUserId: admin.id })
    const colleague = { id: randomUUID(), features: [] as string[] }
    await db.update(prospects).set({ assignedUserId: null }).where(eq(prospects.id, free.id))
    for (const [p, label] of [[free, 'li-free'], [mine, 'li-mine'], [theirs, 'li-theirs']] as const) await addPoint(p.id, 'email', address(label))
    const [list] = await db.insert(prospectLists).values({ ownerUserId: admin.id, name: 'QA lista' }).returning()
    listIds.push(list!.id)
    await db.insert(prospectListMembers).values([free, mine, theirs].map((p) => ({ listId: list!.id, prospectId: p.id })))

    const result = await enrollRecipients(seq.id, undefined, { me: colleague, listId: list!.id })

    // free and mine are unassigned (visible to everyone); theirs belongs to the admin.
    expect(result.enrolled).toBe(2)
    const rows = await db.select({ prospectId: emailSequenceEnrollments.prospectId }).from(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.sequenceId, seq.id))
    expect(rows.map((r) => r.prospectId).sort()).toEqual([free.id, mine.id].sort())
  })
})

describe('diagnostics', () => {
  it('counts sent / opened / clicked / bounced per step and variant, replied by last send', async () => {
    const [ta, tb] = [await makeTemplate(), await makeTemplate()]
    const { seq, steps } = await makeSequence([
      { templateId: ta.id, variantBTemplateId: tb.id, delayDays: 0 },
      { kind: 'call', delayDays: 1, taskTitle: 'Sună' },
    ])
    const stepId = steps[0]!.id
    const e1 = await enroll(seq.id, null, address('dg1'), { status: 'replied', currentStep: 2 })
    const e2 = await enroll(seq.id, null, address('dg2'), { currentStep: 1 })
    const base = { subject: 'x', kind: 'sequence' as const, sequenceStepId: stepId }
    await db.insert(emailSends).values([
      { ...base, recipient: addresses[0]!, sequenceEnrollmentId: e1.id, variant: 'A', status: 'delivered', openedAt: new Date(), clickedAt: new Date() },
      { ...base, recipient: addresses[1]!, sequenceEnrollmentId: e2.id, variant: 'B', status: 'bounced' },
      { ...base, recipient: addresses[1]!, sequenceEnrollmentId: e2.id, variant: 'B', status: 'scheduled' },
    ])

    const diagnostics = await getSequenceDiagnostics(seq.id)

    expect(diagnostics!.paused).toBeNull()
    expect(diagnostics!.steps[0]).toMatchObject({
      kind: 'email',
      variants: [
        { variant: 'A', sent: 1, opened: 1, clicked: 1, replied: 1, bounced: 0 },
        { variant: 'B', sent: 1, opened: 0, clicked: 0, replied: 0, bounced: 1 },
      ],
    })
    expect(diagnostics!.steps[1]).toMatchObject({ kind: 'call', reached: 1 })
  })
})
