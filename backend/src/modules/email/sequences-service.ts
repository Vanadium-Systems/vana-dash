import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { emailSequenceEnrollments, emailSequences, emailSequenceSteps } from '../../shared/db/schema/index.js'
import { isPublicEmailDomain } from '../../shared/lib/email-domains.js'
import type { DrizzleTx } from '../../shared/lib/sequences.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { assertCanSendFrom } from './mailboxes.js'
import type { EnrollSchema, SequenceCreateSchema, SequenceUpdateSchema } from './sequences-schema.js'
import { tr } from '../../shared/lib/i18n.js'

type SequenceRow = typeof emailSequences.$inferSelect
type SequenceStepRow = typeof emailSequenceSteps.$inferSelect
type EnrollmentRow = typeof emailSequenceEnrollments.$inferSelect

export interface SequenceWithSteps extends SequenceRow {
  steps: SequenceStepRow[]
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

async function attachSteps(sequences: SequenceRow[]): Promise<SequenceWithSteps[]> {
  if (sequences.length === 0) return []
  const ids = sequences.map((s) => s.id)
  const steps = await db
    .select()
    .from(emailSequenceSteps)
    .where(and(isNull(emailSequenceSteps.deletedAt), inArray(emailSequenceSteps.sequenceId, ids)))
    .orderBy(asc(emailSequenceSteps.stepOrder))
  const byId = new Map<string, SequenceStepRow[]>()
  for (const step of steps) {
    const list = byId.get(step.sequenceId) ?? []
    list.push(step)
    byId.set(step.sequenceId, list)
  }
  return sequences.map((s) => ({ ...s, steps: byId.get(s.id) ?? [] }))
}

export async function listSequences(): Promise<SequenceWithSteps[]> {
  const rows = await db.select().from(emailSequences).where(isNull(emailSequences.deletedAt)).orderBy(desc(emailSequences.createdAt))
  return attachSteps(rows)
}

export async function getSequence(id: string): Promise<SequenceWithSteps | null> {
  const [row] = await db
    .select()
    .from(emailSequences)
    .where(and(eq(emailSequences.id, id), isNull(emailSequences.deletedAt)))
  if (!row) return null
  const [withSteps] = await attachSteps([row])
  return withSteps ?? null
}

async function replaceSteps(tx: DrizzleTx, sequenceId: string, steps: z.infer<typeof SequenceCreateSchema>['steps']): Promise<void> {
  await tx.delete(emailSequenceSteps).where(eq(emailSequenceSteps.sequenceId, sequenceId))
  await tx.insert(emailSequenceSteps).values(
    steps.map((step, index) => ({
      sequenceId,
      stepOrder: index + 1,
      templateId: step.templateId,
      delayDays: step.delayDays,
    })),
  )
}

export async function createSequence(me: SessionUser, input: z.infer<typeof SequenceCreateSchema>): Promise<SequenceWithSteps> {
  // Secvența trimite singură, la ora stabilită, de pe identitatea aleasă acum — deci
  // verificarea de cutie e a omului care o creează (C2), la fel ca la compose.
  assertCanSendFrom(me, input.fromIdentity)
  return db.transaction(async (tx) => {
    const [sequence] = await tx.insert(emailSequences).values({ name: input.name, fromIdentity: input.fromIdentity }).returning()
    if (!sequence) throw new Error(tr('errors.email.sequenceInsertFailed'))
    await replaceSteps(tx, sequence.id, input.steps)
    const steps = await tx.select().from(emailSequenceSteps).where(eq(emailSequenceSteps.sequenceId, sequence.id)).orderBy(asc(emailSequenceSteps.stepOrder))
    return { ...sequence, steps }
  })
}

export async function updateSequence(me: SessionUser, id: string, input: z.infer<typeof SequenceUpdateSchema>): Promise<SequenceWithSteps | null> {
  if (input.fromIdentity) assertCanSendFrom(me, input.fromIdentity)
  return db.transaction(async (tx) => {
    const { steps, ...fields } = input
    const [sequence] = await tx
      .update(emailSequences)
      .set({ ...fields, updatedAt: new Date() })
      .where(and(eq(emailSequences.id, id), isNull(emailSequences.deletedAt)))
      .returning()
    if (!sequence) return null
    if (steps) await replaceSteps(tx, id, steps)
    const stepRows = await tx.select().from(emailSequenceSteps).where(eq(emailSequenceSteps.sequenceId, id)).orderBy(asc(emailSequenceSteps.stepOrder))
    return { ...sequence, steps: stepRows }
  })
}

export async function softDeleteSequence(id: string): Promise<boolean> {
  const [row] = await db
    .update(emailSequences)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(emailSequences.id, id), isNull(emailSequences.deletedAt)))
    .returning({ id: emailSequences.id })
  return Boolean(row)
}

// ── Enrollments ──────────────────────────────────────────────────────────────

export async function listEnrollments(sequenceId: string): Promise<EnrollmentRow[]> {
  return db
    .select()
    .from(emailSequenceEnrollments)
    .where(and(eq(emailSequenceEnrollments.sequenceId, sequenceId), isNull(emailSequenceEnrollments.deletedAt)))
    .orderBy(desc(emailSequenceEnrollments.enrolledAt))
}

export interface EnrollResult {
  enrolled: number
  /** Deja înrolat în această secvență (UNIQUE sequence_id+recipient_email) — nu creează al doilea rând. */
  alreadyEnrolled: string[]
}

/**
 * Înrolare bulk (Prospectare → „Adaugă în secvență", vezi PLAN.md). `next_send_at` al primului
 * pas = enrolledAt + delayDays-ul pasului 1 (0 = trimis la prima rulare a cron-ului, nu instant).
 * Idempotent — un destinatar deja înrolat în ACEEAȘI secvență e raportat separat, nu eroare.
 */
export async function enrollRecipients(sequenceId: string, recipients: z.infer<typeof EnrollSchema>['recipients']): Promise<EnrollResult> {
  const [firstStep] = await db
    .select()
    .from(emailSequenceSteps)
    .where(and(eq(emailSequenceSteps.sequenceId, sequenceId), eq(emailSequenceSteps.stepOrder, 1)))
    .limit(1)
  if (!firstStep) throw new Error(tr('errors.email.sequenceNoSteps'))

  const now = new Date()
  const nextSendAt = addDays(now, firstStep.delayDays)

  let enrolled = 0
  const alreadyEnrolled: string[] = []

  for (const recipient of recipients) {
    const [row] = await db
      .insert(emailSequenceEnrollments)
      .values({
        sequenceId,
        prospectId: recipient.prospectId ?? null,
        recipientEmail: recipient.email,
        recipientName: recipient.nume ?? null,
        nextSendAt,
        enrolledAt: now,
      })
      .onConflictDoNothing({ target: [emailSequenceEnrollments.sequenceId, emailSequenceEnrollments.recipientEmail] })
      .returning({ id: emailSequenceEnrollments.id })

    if (row) enrolled++
    else alreadyEnrolled.push(recipient.email)
  }

  return { enrolled, alreadyEnrolled }
}

export interface SequenceStats {
  total: number
  byStatus: Record<EnrollmentRow['status'], number>
  byStep: { step: number; label: string; count: number }[]
}

/**
 * Status agregat pt. o secvență — câți destinatari, pe ce status, la ce pas au ajuns. Agregare
 * SQL (GROUP BY), regula #9 CLAUDE.md — nicio numărare pe array-uri JS. `byStep` include
 * step=0 (neîncepuți încă) și pornește de la lista de pași a secvenței (nu doar valorile deja
 * văzute în enrollments) ca un pas fără nimeni trimis încă să apară totuși cu count=0.
 */
export async function getSequenceStats(sequenceId: string): Promise<SequenceStats> {
  const [statusRows, stepRows, steps] = await Promise.all([
    db
      .select({ status: emailSequenceEnrollments.status, count: sql<number>`count(*)::int` })
      .from(emailSequenceEnrollments)
      .where(and(eq(emailSequenceEnrollments.sequenceId, sequenceId), isNull(emailSequenceEnrollments.deletedAt)))
      .groupBy(emailSequenceEnrollments.status),
    db
      .select({ step: emailSequenceEnrollments.currentStep, count: sql<number>`count(*)::int` })
      .from(emailSequenceEnrollments)
      .where(and(eq(emailSequenceEnrollments.sequenceId, sequenceId), isNull(emailSequenceEnrollments.deletedAt)))
      .groupBy(emailSequenceEnrollments.currentStep),
    db
      .select({ stepOrder: emailSequenceSteps.stepOrder })
      .from(emailSequenceSteps)
      .where(and(eq(emailSequenceSteps.sequenceId, sequenceId), isNull(emailSequenceSteps.deletedAt)))
      .orderBy(asc(emailSequenceSteps.stepOrder)),
  ])

  const byStatus: SequenceStats['byStatus'] = { active: 0, replied: 0, unsubscribed: 0, completed: 0, failed: 0 }
  let total = 0
  for (const row of statusRows) {
    byStatus[row.status] = row.count
    total += row.count
  }

  const countByStep = new Map(stepRows.map((r) => [r.step, r.count]))
  const byStep = [
    { step: 0, label: tr('errors.email.notStarted'), count: countByStep.get(0) ?? 0 },
    ...steps.map((s) => ({ step: s.stepOrder, label: `Pas ${s.stepOrder}`, count: countByStep.get(s.stepOrder) ?? 0 })),
  ]

  return { total, byStatus, byStep }
}

/** Oprire manuală din UI (backstop — nu depinde doar de euristica de reply, vezi PLAN.md Risks). */
export async function updateEnrollmentStatus(sequenceId: string, enrollmentId: string, status: 'unsubscribed' | 'active' | 'replied'): Promise<EnrollmentRow | null> {
  const [row] = await db
    .update(emailSequenceEnrollments)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(emailSequenceEnrollments.id, enrollmentId), eq(emailSequenceEnrollments.sequenceId, sequenceId), isNull(emailSequenceEnrollments.deletedAt)))
    .returning()
  return row ?? null
}

/**
 * Oprire la răspuns (inbound-service.ts, la ingest-ul unui mesaj primit) — trece TOATE
 * secvențele active ale adresei SAU ale DOMENIULUI pe 'replied', nu doar cea "relevantă"
 * (euristica de threading existentă e pe subiect+participanți, nu pe In-Reply-To real — mai
 * sigur să oprim larg decât să ratăm un răspuns, decizie fixată în PLAN.md). Matching pe
 * domeniu adăugat 2026-08-27 (decizie Stefan, exemplu real: outreach trimis la
 * contact@firma.example, răspuns venit de la alt.nume@firma.example — altă persoană din
 * aceeași companie — secvența continua să trimită follow-up-uri deși cineva răspunsese deja).
 * Normalizare identică unsubscribe-service.ts.
 *
 * FIX 2026-09-03 (bug real Stefan): matching pe domeniu întreg NU se aplică domeniilor publice
 * de webmail (gmail.com, yahoo.com etc.) — un singur răspuns de pe @yahoo.com oprea greșit
 * TOȚI ceilalți destinatari @yahoo.com din listă, deși nu au nicio legătură unii cu alții.
 * Pe domenii publice, matching-ul rămâne strict pe adresa exactă.
 */
export async function stopSequencesForReplyFrom(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase()
  const domain = normalized.split('@')[1] ?? ''
  const domainMatchAllowed = domain !== '' && !isPublicEmailDomain(domain)
  await db
    .update(emailSequenceEnrollments)
    .set({ status: 'replied', updatedAt: new Date() })
    .where(
      and(
        eq(emailSequenceEnrollments.status, 'active'),
        sql`(
          lower(${emailSequenceEnrollments.recipientEmail}) = ${normalized}
          OR (${domainMatchAllowed} AND split_part(lower(${emailSequenceEnrollments.recipientEmail}), '@', 2) = ${domain})
        )`,
        isNull(emailSequenceEnrollments.deletedAt),
      ),
    )
}
