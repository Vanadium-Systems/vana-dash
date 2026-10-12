/**
 * sequences-service.ts (2026-08-12, sprint Secvențe outreach) — CRUD secvențe/pași,
 * enroll (dedup pe UNIQUE sequence_id+recipient_email), oprire manuală, oprire la răspuns.
 * Integration test, pg real (test/setup.ts).
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { emailSequenceEnrollments, emailSequences, emailSequenceSteps, emailTemplates } from '../../shared/db/schema/index.js'
import {
  createSequence,
  enrollRecipients,
  getSequence,
  getSequenceStats,
  listSequences,
  softDeleteSequence,
  stopSequencesForReplyFrom,
  updateEnrollmentStatus,
  updateSequence,
} from './sequences-service.js'
import type { SessionUser } from '../../shared/lib/session.js'

// Admin (cutii `null` = toate), ca testele de CRUD să nu fie legate de o cutie anume.
const admin: SessionUser = {
  id: '00000000-0000-4000-8000-000000000000',
  email: 'qa-sequences@test.local',
  displayName: 'QA secvențe',
  role: { id: '00000000-0000-4000-8000-000000000000', name: 'Admin', kind: 'admin' },
  isPlatformAdmin: false,
  features: [],
  mailboxes: null,
  status: 'active',
  lastSeenAt: null,
  notificationPrefs: null,
  navLayout: null,
  updatesSeenAt: null,
  sessionVersion: 1,
}

const templateIds: string[] = []
const sequenceIds: string[] = []

async function makeTemplate(name = 'QA seq template') {
  const [row] = await db.insert(emailTemplates).values({ name, subject: 'Subiect {{nume}}', body: 'Bună {{nume}}' }).returning()
  templateIds.push(row!.id)
  return row!
}

afterAll(async () => {
  if (sequenceIds.length) await db.delete(emailSequences).where(inArray(emailSequences.id, sequenceIds.splice(0)))
  if (templateIds.length) await db.delete(emailTemplates).where(inArray(emailTemplates.id, templateIds.splice(0)))
})

describe('createSequence / getSequence / listSequences', () => {
  it('creates a sequence with ordered steps, retrievable via getSequence and listSequences', async () => {
    const tpl1 = await makeTemplate()
    const tpl2 = await makeTemplate()
    const created = await createSequence(admin, {
      name: 'QA drip',
      fromIdentity: 'outreach',
      steps: [
        { templateId: tpl1.id, delayDays: 0 },
        { templateId: tpl2.id, delayDays: 5 },
      ],
    })
    sequenceIds.push(created.id)

    expect(created.steps).toHaveLength(2)
    expect(created.steps[0]!.stepOrder).toBe(1)
    expect(created.steps[1]!.stepOrder).toBe(2)
    expect(created.steps[1]!.delayDays).toBe(5)

    const fetched = await getSequence(created.id)
    expect(fetched?.steps.map((s) => s.templateId)).toEqual([tpl1.id, tpl2.id])

    const list = await listSequences()
    expect(list.some((s) => s.id === created.id)).toBe(true)
  })
})

describe('updateSequence', () => {
  it('replaces steps completely when steps is provided (not a merge)', async () => {
    const tpl1 = await makeTemplate()
    const tpl2 = await makeTemplate()
    const tpl3 = await makeTemplate()
    const created = await createSequence(admin, { name: 'QA replace-steps', fromIdentity: 'contact', steps: [{ templateId: tpl1.id, delayDays: 0 }] })
    sequenceIds.push(created.id)

    const updated = await updateSequence(admin, created.id, { steps: [{ templateId: tpl2.id, delayDays: 1 }, { templateId: tpl3.id, delayDays: 2 }] })

    expect(updated?.steps).toHaveLength(2)
    expect(updated?.steps.map((s) => s.templateId)).toEqual([tpl2.id, tpl3.id])
  })

  it('updates fields (active/name) without touching steps when steps is omitted', async () => {
    const tpl = await makeTemplate()
    const created = await createSequence(admin, { name: 'QA fields-only', fromIdentity: 'contact', steps: [{ templateId: tpl.id, delayDays: 0 }] })
    sequenceIds.push(created.id)

    const updated = await updateSequence(admin, created.id, { active: false })

    expect(updated?.active).toBe(false)
    expect(updated?.steps).toHaveLength(1)
  })

  it('returns null for a nonexistent or already soft-deleted sequence', async () => {
    expect(await updateSequence(admin, '00000000-0000-0000-0000-000000000000', { active: false })).toBeNull()
  })
})

describe('softDeleteSequence', () => {
  it('soft-deletes — no longer returned by getSequence/listSequences', async () => {
    const tpl = await makeTemplate()
    const created = await createSequence(admin, { name: 'QA to-delete', fromIdentity: 'contact', steps: [{ templateId: tpl.id, delayDays: 0 }] })
    sequenceIds.push(created.id)

    expect(await softDeleteSequence(created.id)).toBe(true)
    expect(await getSequence(created.id)).toBeNull()
    expect((await listSequences()).some((s) => s.id === created.id)).toBe(false)
  })
})

describe('enrollRecipients', () => {
  it('enrolls new recipients, computing next_send_at from step 1 delayDays', async () => {
    const tpl = await makeTemplate()
    const created = await createSequence(admin, { name: 'QA enroll', fromIdentity: 'outreach', steps: [{ templateId: tpl.id, delayDays: 2 }] })
    sequenceIds.push(created.id)

    const result = await enrollRecipients(created.id, [{ email: 'enroll-a@example.com', nume: 'Ana' }])
    expect(result.enrolled).toBe(1)
    expect(result.alreadyEnrolled).toHaveLength(0)

    const [row] = await db.select().from(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.sequenceId, created.id))
    expect(row?.recipientEmail).toBe('enroll-a@example.com')
    expect(row?.status).toBe('active')
    expect(row?.currentStep).toBe(0)
    const daysUntilNext = (row!.nextSendAt.getTime() - Date.now()) / 86_400_000
    expect(daysUntilNext).toBeGreaterThan(1.9)
    expect(daysUntilNext).toBeLessThan(2.1)
  })

  it('is idempotent — a recipient already enrolled in the same sequence is reported, not duplicated', async () => {
    const tpl = await makeTemplate()
    const created = await createSequence(admin, { name: 'QA enroll-dedup', fromIdentity: 'outreach', steps: [{ templateId: tpl.id, delayDays: 0 }] })
    sequenceIds.push(created.id)

    const first = await enrollRecipients(created.id, [{ email: 'dup-enroll@example.com' }])
    expect(first.enrolled).toBe(1)

    const second = await enrollRecipients(created.id, [{ email: 'dup-enroll@example.com' }])
    expect(second.enrolled).toBe(0)
    expect(second.alreadyEnrolled).toEqual(['dup-enroll@example.com'])

    const rows = await db.select().from(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.sequenceId, created.id))
    expect(rows).toHaveLength(1)
  })

  it('rejects enroll on a sequence with no step 1', async () => {
    const created = await createSequence(admin, {
      name: 'QA no-steps-yet',
      fromIdentity: 'contact',
      steps: [{ templateId: (await makeTemplate()).id, delayDays: 0 }],
    })
    sequenceIds.push(created.id)
    // Golim pașii direct în DB (updateSequence cere min 1 pas) — simulează o secvență inconsistentă.
    await db.delete(emailSequenceSteps).where(eq(emailSequenceSteps.sequenceId, created.id))

    await expect(enrollRecipients(created.id, [{ email: 'no-step@example.com' }])).rejects.toThrow('Secvență fără niciun pas')
  })
})

describe('updateEnrollmentStatus (oprire manuală)', () => {
  it('flips an active enrollment to unsubscribed', async () => {
    const tpl = await makeTemplate()
    const created = await createSequence(admin, { name: 'QA manual-stop', fromIdentity: 'contact', steps: [{ templateId: tpl.id, delayDays: 0 }] })
    sequenceIds.push(created.id)
    await enrollRecipients(created.id, [{ email: 'manual-stop@example.com' }])
    const [enrollment] = await db.select().from(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.sequenceId, created.id))

    const updated = await updateEnrollmentStatus(created.id, enrollment!.id, 'unsubscribed')
    expect(updated?.status).toBe('unsubscribed')
  })

  it('flips a wrongly-stopped enrollment back to active (2026-09-03 — backstop pt. bug reply-matching)', async () => {
    const tpl = await makeTemplate()
    const created = await createSequence(admin, { name: 'QA manual-reactivate', fromIdentity: 'contact', steps: [{ templateId: tpl.id, delayDays: 0 }] })
    sequenceIds.push(created.id)
    await enrollRecipients(created.id, [{ email: 'manual-reactivate@example.com' }])
    const [enrollment] = await db.select().from(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.sequenceId, created.id))
    await updateEnrollmentStatus(created.id, enrollment!.id, 'unsubscribed')

    const reactivated = await updateEnrollmentStatus(created.id, enrollment!.id, 'active')
    expect(reactivated?.status).toBe('active')
  })

  it('returns null for an enrollment id that does not belong to the given sequence', async () => {
    const tpl = await makeTemplate()
    const seqA = await createSequence(admin, { name: 'QA seq-a', fromIdentity: 'contact', steps: [{ templateId: tpl.id, delayDays: 0 }] })
    const seqB = await createSequence(admin, { name: 'QA seq-b', fromIdentity: 'contact', steps: [{ templateId: tpl.id, delayDays: 0 }] })
    sequenceIds.push(seqA.id, seqB.id)
    await enrollRecipients(seqA.id, [{ email: 'cross-seq@example.com' }])
    const [enrollment] = await db.select().from(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.sequenceId, seqA.id))

    expect(await updateEnrollmentStatus(seqB.id, enrollment!.id, 'unsubscribed')).toBeNull()
  })
})

describe('stopSequencesForReplyFrom (2026-08-12 — hook din inbound-service.ts la un mesaj primit)', () => {
  it('flips every active enrollment for that email (case-insensitive) to replied, leaving others untouched', async () => {
    const tpl = await makeTemplate()
    const seqA = await createSequence(admin, { name: 'QA reply-a', fromIdentity: 'contact', steps: [{ templateId: tpl.id, delayDays: 0 }] })
    const seqB = await createSequence(admin, { name: 'QA reply-b', fromIdentity: 'contact', steps: [{ templateId: tpl.id, delayDays: 0 }] })
    sequenceIds.push(seqA.id, seqB.id)
    await enrollRecipients(seqA.id, [{ email: 'Replier@Example.com' }])
    await enrollRecipients(seqB.id, [{ email: 'replier@example.com' }])
    await enrollRecipients(seqA.id, [{ email: 'unrelated@other-domain.com' }])

    await stopSequencesForReplyFrom('replier@example.com')

    const replierRows = await db
      .select()
      .from(emailSequenceEnrollments)
      .where(inArray(emailSequenceEnrollments.sequenceId, [seqA.id, seqB.id]))
    const replier = replierRows.filter((r) => r.recipientEmail.toLowerCase() === 'replier@example.com')
    const other = replierRows.find((r) => r.recipientEmail === 'unrelated@other-domain.com')
    expect(replier).toHaveLength(2)
    expect(replier.every((r) => r.status === 'replied')).toBe(true)
    expect(other?.status).toBe('active')
  })

  it('also flips enrollments on the SAME DOMAIN, different address (2026-08-27 — reply de la altă persoană din aceeași companie)', async () => {
    const tpl = await makeTemplate()
    const seq = await createSequence(admin, { name: 'QA reply-domain', fromIdentity: 'contact', steps: [{ templateId: tpl.id, delayDays: 0 }] })
    sequenceIds.push(seq.id)
    // outreach trimis la contact@, răspunsul vine de la altcineva@aceeași-companie.
    await enrollRecipients(seq.id, [{ email: 'contact@acme-test.ro' }])

    await stopSequencesForReplyFrom('maria@acme-test.ro')

    const [enrollment] = await db.select().from(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.sequenceId, seq.id))
    expect(enrollment?.status).toBe('replied')
  })

  it('NU face match pe domeniu întreg pt. domenii publice de webmail — un răspuns de pe @yahoo.com nu oprește alți destinatari @yahoo.com neafiliați (2026-09-03, bug real Stefan)', async () => {
    const tpl = await makeTemplate()
    const seq = await createSequence(admin, { name: 'QA reply-public-domain', fromIdentity: 'contact', steps: [{ templateId: tpl.id, delayDays: 0 }] })
    sequenceIds.push(seq.id)
    await enrollRecipients(seq.id, [{ email: 'a@yahoo.com' }, { email: 'b@yahoo.com' }])

    await stopSequencesForReplyFrom('a@yahoo.com')

    const rows = await db.select().from(emailSequenceEnrollments).where(eq(emailSequenceEnrollments.sequenceId, seq.id))
    const replier = rows.find((r) => r.recipientEmail === 'a@yahoo.com')
    const unrelated = rows.find((r) => r.recipientEmail === 'b@yahoo.com')
    expect(replier?.status).toBe('replied')
    expect(unrelated?.status).toBe('active')
  })
})

describe('getSequenceStats (2026-09-03 — status agregat, tab Secvențe)', () => {
  it('aggregates byStatus and byStep across enrollments, including steps with zero enrollments', async () => {
    const tpl = await makeTemplate()
    const seq = await createSequence(admin, {
      name: 'QA stats',
      fromIdentity: 'contact',
      steps: [
        { templateId: tpl.id, delayDays: 0 },
        { templateId: tpl.id, delayDays: 3 },
      ],
    })
    sequenceIds.push(seq.id)
    // Domenii DIFERITE — stopSequencesForReplyFrom face match pe domeniu întreg pt. domenii
    // custom (nu doar adresă exactă), la fel ca example.com aici ar fi flipuit toate 3 rândurile.
    await enrollRecipients(seq.id, [
      { email: 'stats-a@stats-domain-a.example' },
      { email: 'stats-b@stats-domain-b.example' },
      { email: 'stats-c@stats-domain-c.example' },
    ])
    // Un enrollment "a răspuns" (stopSequencesForReplyFrom, ca în fluxul real) — restul rămân active/neîncepuți.
    await stopSequencesForReplyFrom('stats-a@stats-domain-a.example')

    const stats = await getSequenceStats(seq.id)

    expect(stats.total).toBe(3)
    expect(stats.byStatus.replied).toBe(1)
    expect(stats.byStatus.active).toBe(2)
    // Toate 3 sunt la currentStep=0 (enrollRecipients nu trimite nimic, doar programează) —
    // ambii pași ai secvenței apar în byStep, inclusiv „Pas 2" cu count=0 (niciun enrollment
    // n-a ajuns acolo încă) — nu doar valorile deja văzute în DB.
    expect(stats.byStep).toEqual([
      { step: 0, label: 'Neîncepuți', count: 3 },
      { step: 1, label: 'Pas 1', count: 0 },
      { step: 2, label: 'Pas 2', count: 0 },
    ])
  })

  it('returns zeroed stats for a sequence with no enrollments', async () => {
    const tpl = await makeTemplate()
    const seq = await createSequence(admin, { name: 'QA stats empty', fromIdentity: 'contact', steps: [{ templateId: tpl.id, delayDays: 0 }] })
    sequenceIds.push(seq.id)

    const stats = await getSequenceStats(seq.id)

    expect(stats.total).toBe(0)
    expect(stats.byStatus).toEqual({ active: 0, replied: 0, unsubscribed: 0, completed: 0, failed: 0 })
    expect(stats.byStep).toEqual([{ step: 0, label: 'Neîncepuți', count: 0 }, { step: 1, label: 'Pas 1', count: 0 }])
  })
})
