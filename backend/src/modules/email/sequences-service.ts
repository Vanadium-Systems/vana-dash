import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { config } from '../../shared/config.js'
import { db } from '../../shared/db/client.js'
import {
  emailSends,
  emailSequenceEnrollments,
  emailSequences,
  emailSequenceSteps,
  emailSuppressions,
  prospectContactPoints,
  prospectListMembers,
  prospectPeople,
  prospects,
} from '../../shared/db/schema/index.js'
import { recordAudit } from '../../shared/lib/audit.js'
import { isPublicEmailDomain } from '../../shared/lib/email-domains.js'
import { activeAdminIds, notify } from '../../shared/lib/notify.js'
import { visibleProspectsWhere } from '../../shared/lib/prospect-access.js'
import type { DrizzleTx } from '../../shared/lib/sequences.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { assertCanSendFrom } from './mailboxes.js'
import { getSequenceBouncePause, type SequenceBouncePause } from './settings-service.js'
import type { EnrollSchema, SequenceCreateSchema, SequenceUpdateSchema } from './sequences-schema.js'
import { tr, trFor } from '../../shared/lib/i18n.js'

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
      kind: step.kind ?? 'email',
      templateId: step.templateId ?? null,
      variantBTemplateId: step.variantBTemplateId ?? null,
      taskTitle: step.taskTitle ?? null,
      taskDescription: step.taskDescription ?? null,
      delayDays: step.delayDays,
    })),
  )
}

export async function createSequence(me: SessionUser, input: z.infer<typeof SequenceCreateSchema>): Promise<SequenceWithSteps> {
  // Secvența trimite singură, la ora stabilită, de pe identitatea aleasă acum — deci
  // verificarea de cutie e a omului care o creează (C2), la fel ca la compose.
  assertCanSendFrom(me, input.fromIdentity)
  return db.transaction(async (tx) => {
    const [sequence] = await tx
      .insert(emailSequences)
      .values({ name: input.name, fromIdentity: input.fromIdentity, stopOnMeeting: input.stopOnMeeting, stopOnWonLost: input.stopOnWonLost })
      .returning()
    if (!sequence) throw new Error(tr('errors.email.sequenceInsertFailed'))
    await replaceSteps(tx, sequence.id, input.steps)
    const steps = await tx.select().from(emailSequenceSteps).where(eq(emailSequenceSteps.sequenceId, sequence.id)).orderBy(asc(emailSequenceSteps.stepOrder))
    return { ...sequence, steps }
  })
}

export async function updateSequence(me: SessionUser, id: string, input: z.infer<typeof SequenceUpdateSchema>): Promise<SequenceWithSteps | null> {
  if (input.fromIdentity) assertCanSendFrom(me, input.fromIdentity)
  return db.transaction(async (tx) => {
    const { steps, paused, ...fields } = input
    const [sequence] = await tx
      .update(emailSequences)
      .set({ ...fields, ...(paused === false ? { pausedAt: null, pausedReason: null } : {}), updatedAt: new Date() })
      .where(and(eq(emailSequences.id, id), isNull(emailSequences.deletedAt)))
      .returning()
    if (!sequence) return null
    if (paused === false) await recordAudit({ action: 'email.sequence_resumed', entityType: 'email_sequence', entityId: id })
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
    .orderBy(
      sql`case
        when ${emailSequenceEnrollments.status} = 'active' and ${emailSequenceEnrollments.currentStep} = 0 then 0
        when ${emailSequenceEnrollments.status} = 'active' then 1
        when ${emailSequenceEnrollments.status} = 'completed' then 2
        when ${emailSequenceEnrollments.status} = 'replied' then 3
        else 4 end`,
      asc(emailSequenceEnrollments.currentStep),
      desc(emailSequenceEnrollments.enrolledAt),
    )
}

export type EnrollSkipReason = 'SUPPRESSED' | 'BOUNCED' | 'UNSUBSCRIBED' | 'DO_NOT_CONTACT' | 'NO_PHONE' | 'NO_EMAIL' | 'ALREADY_ENROLLED'

export interface EnrollSkip {
  recipient?: string
  prospectId?: string
  reason: EnrollSkipReason
}

export interface EnrollResult {
  enrolled: number
  skipped: EnrollSkip[]
  /** Subset of `skipped` with ALREADY_ENROLLED, kept for the dialog that predates `skipped`. */
  alreadyEnrolled: string[]
}

interface ContactPointRow {
  prospectId: string
  kind: 'phone' | 'email'
  valueNormalized: string
  value: string
  status: 'ok' | 'bounced' | 'unsubscribed' | 'invalid'
  isPrimary: boolean
  personName: string | null
  isDecisionMaker: boolean
  doNotContact: boolean
  createdAt: Date
}

async function loadContactPoints(prospectIds: string[], kind: 'phone' | 'email'): Promise<Map<string, ContactPointRow[]>> {
  const byProspect = new Map<string, ContactPointRow[]>()
  if (prospectIds.length === 0) return byProspect
  const rows = await db
    .select({
      prospectId: prospectContactPoints.prospectId,
      kind: prospectContactPoints.kind,
      valueNormalized: prospectContactPoints.valueNormalized,
      value: prospectContactPoints.value,
      status: prospectContactPoints.status,
      isPrimary: prospectContactPoints.isPrimary,
      personName: prospectPeople.name,
      isDecisionMaker: sql<boolean>`coalesce(${prospectPeople.isDecisionMaker}, false)`,
      doNotContact: sql<boolean>`coalesce(${prospectPeople.doNotContact}, false)`,
      createdAt: prospectContactPoints.createdAt,
    })
    .from(prospectContactPoints)
    .leftJoin(prospectPeople, and(eq(prospectPeople.id, prospectContactPoints.personId), isNull(prospectPeople.deletedAt)))
    .where(and(inArray(prospectContactPoints.prospectId, prospectIds), eq(prospectContactPoints.kind, kind), isNull(prospectContactPoints.deletedAt)))
  for (const row of rows) {
    const list = byProspect.get(row.prospectId) ?? []
    list.push(row)
    byProspect.set(row.prospectId, list)
  }
  return byProspect
}

type BlockReason = 'BOUNCED' | 'UNSUBSCRIBED' | 'DO_NOT_CONTACT' | 'NO_EMAIL'

/** Why none of these points can be used, in the order the person should hear about it. */
function whyUnusable(points: ContactPointRow[]): BlockReason {
  if (points.some((p) => p.status === 'ok' && p.doNotContact)) return 'DO_NOT_CONTACT'
  if (points.some((p) => p.status === 'bounced')) return 'BOUNCED'
  if (points.some((p) => p.status === 'unsubscribed')) return 'UNSUBSCRIBED'
  return 'NO_EMAIL'
}

const isUsable = (p: ContactPointRow) => p.status === 'ok' && !p.doNotContact

/** Decision maker's address first, then the primary one, then the oldest. */
function pickEmail(points: ContactPointRow[]): ContactPointRow | null {
  const usable = points.filter(isUsable).sort(
    (a, b) =>
      Number(b.isDecisionMaker) - Number(a.isDecisionMaker) || Number(b.isPrimary) - Number(a.isPrimary) || a.createdAt.getTime() - b.createdAt.getTime(),
  )
  return usable[0] ?? null
}

/** Reason an address of a prospect must not get email now, or null. Several points can hold the
 *  same address (company and person): it is blocked only if none of them is usable. */
export async function emailBlockedReason(prospectId: string, address: string): Promise<BlockReason | null> {
  const points = (await loadContactPoints([prospectId], 'email')).get(prospectId) ?? []
  const same = points.filter((p) => p.valueNormalized === address.trim().toLowerCase())
  if (same.length === 0 || same.some(isUsable)) return null
  return whyUnusable(same)
}

// recipient_email is NOT NULL and part of the unique key, but a call or LinkedIn step needs no
// address. A prospect without one gets this placeholder, unique per prospect and not a deliverable
// address (".invalid" is reserved, RFC 2606). The runner never emails it: see isPlaceholderRecipient.
export const placeholderRecipient = (prospectId: string) => `prospect:${prospectId}@invalid`
export const isPlaceholderRecipient = (address: string) => address.startsWith('prospect:') && address.endsWith('@invalid')

interface Candidate {
  prospectId: string | null
  email: string | null
  nume: string | null
  /** Set when the address was given explicitly (a free recipient or the UI's pick) rather than resolved from the prospect. */
  explicit: boolean
}

/**
 * Înrolare bulk (Prospectare → „Adaugă în secvență"). Destinatarii vin din `recipients` (adrese
 * date explicit, cu `prospectId` opțional), din membrii unei liste și/sau din `prospectIds`;
 * ultimele două doar pentru prospecții vizibili omului care înrolează. Fiecare destinatar trece
 * prin eligibilitate (suprimări, puncte de contact bounced/dezabonate, „Nu contacta", telefon la
 * primul pas de apel); cei refuzați apar în `skipped` cu motivul. `next_send_at` al primului pas =
 * enrolledAt + delayDays-ul pasului 1 (0 = la prima rulare a cron-ului, nu instant). Idempotent —
 * un destinatar deja înrolat în ACEEAȘI secvență e raportat ca ALREADY_ENROLLED, nu eroare.
 */
export async function enrollRecipients(
  sequenceId: string,
  recipients: z.infer<typeof EnrollSchema>['recipients'],
  options: { me?: Pick<SessionUser, 'id' | 'features'>; listId?: string; prospectIds?: string[] } = {},
): Promise<EnrollResult> {
  const [firstStep] = await db
    .select()
    .from(emailSequenceSteps)
    .where(and(eq(emailSequenceSteps.sequenceId, sequenceId), eq(emailSequenceSteps.stepOrder, 1)))
    .limit(1)
  if (!firstStep) throw new Error(tr('errors.email.sequenceNoSteps'))
  const firstIsEmail = firstStep.kind === 'email'

  const candidates: Candidate[] = (recipients ?? []).map((r) => ({
    prospectId: r.prospectId ?? null,
    email: r.email,
    nume: r.nume ?? null,
    explicit: true,
  }))

  const pickedIds = new Set(options.prospectIds ?? [])
  const fromProspects = new Set<string>()
  if ((options.listId || pickedIds.size > 0) && options.me) {
    const inList = options.listId
      ? sql`${prospects.id} IN (SELECT m."prospect_id" FROM ${prospectListMembers} m WHERE m."list_id" = ${options.listId} AND m."deleted_at" IS NULL)`
      : undefined
    const picked = pickedIds.size > 0 ? inArray(prospects.id, [...pickedIds]) : undefined
    const rows = await db
      .select({ id: prospects.id })
      .from(prospects)
      .where(and(isNull(prospects.deletedAt), visibleProspectsWhere(options.me), picked && inList ? or(picked, inList) : (picked ?? inList)))
    const explicitIds = new Set(candidates.map((c) => c.prospectId))
    for (const row of rows) if (!explicitIds.has(row.id)) fromProspects.add(row.id)
  }

  const prospectIds = [
    ...new Set([...fromProspects, ...candidates.map((c) => c.prospectId).filter((id): id is string => Boolean(id))]),
  ]
  const [emailPoints, phonePoints] = await Promise.all([
    loadContactPoints(prospectIds, 'email'),
    firstIsEmail ? Promise.resolve(new Map<string, ContactPointRow[]>()) : loadContactPoints(prospectIds, 'phone'),
  ])

  const skipped: EnrollSkip[] = []
  const eligible: Array<{ prospectId: string | null; email: string; nume: string | null }> = []

  for (const prospectId of fromProspects) {
    const points = emailPoints.get(prospectId) ?? []
    const chosen = pickEmail(points)
    if (firstIsEmail) {
      if (!chosen) skipped.push({ prospectId, reason: whyUnusable(points) })
      else eligible.push({ prospectId, email: chosen.valueNormalized, nume: chosen.personName })
    } else {
      // The address is only kept for later email steps; the runner re-checks it before any send.
      const kept = chosen ?? points.find((p) => p.isPrimary) ?? points[0]
      eligible.push({ prospectId, email: kept?.valueNormalized ?? placeholderRecipient(prospectId), nume: kept?.personName ?? null })
    }
  }

  const suppressedRows = candidates.length
    ? await db.select({ email: emailSuppressions.email }).from(emailSuppressions).where(inArray(emailSuppressions.email, candidates.map((c) => c.email!.trim().toLowerCase())))
    : []
  const suppressed = new Set(suppressedRows.map((r) => r.email))

  for (const candidate of candidates) {
    const email = candidate.email!.trim().toLowerCase()
    if (suppressed.has(email)) {
      skipped.push({ recipient: candidate.email!, reason: 'SUPPRESSED' })
      continue
    }
    if (candidate.prospectId) {
      const points = (emailPoints.get(candidate.prospectId) ?? []).filter((p) => p.valueNormalized === email)
      if (points.length > 0 && !points.some(isUsable)) {
        skipped.push({ recipient: candidate.email!, prospectId: candidate.prospectId, reason: whyUnusable(points) })
        continue
      }
    }
    eligible.push({ prospectId: candidate.prospectId, email: candidate.email!, nume: candidate.nume })
  }

  const now = new Date()
  const nextSendAt = addDays(now, firstStep.delayDays)
  let enrolled = 0
  const alreadyEnrolled: string[] = []

  for (const target of eligible) {
    if (!firstIsEmail) {
      // A call or task step needs somewhere to put the task and a usable phone to call.
      if (!target.prospectId) {
        skipped.push({ recipient: target.email, reason: 'NO_PHONE' })
        continue
      }
      if (firstStep.kind === 'call') {
        const phones = phonePoints.get(target.prospectId) ?? []
        if (!phones.some((p) => p.status !== 'invalid' && !p.doNotContact)) {
          skipped.push({ prospectId: target.prospectId, reason: phones.some((p) => p.status !== 'invalid') ? 'DO_NOT_CONTACT' : 'NO_PHONE' })
          continue
        }
      }
    }
    const [row] = await db
      .insert(emailSequenceEnrollments)
      .values({
        sequenceId,
        prospectId: target.prospectId,
        recipientEmail: target.email,
        recipientName: target.nume,
        nextSendAt,
        enrolledAt: now,
      })
      .onConflictDoNothing({ target: [emailSequenceEnrollments.sequenceId, emailSequenceEnrollments.recipientEmail] })
      .returning({ id: emailSequenceEnrollments.id })

    if (row) enrolled++
    else {
      alreadyEnrolled.push(target.email)
      skipped.push({ recipient: target.email, ...(target.prospectId ? { prospectId: target.prospectId } : {}), reason: 'ALREADY_ENROLLED' })
    }
  }

  return { enrolled, skipped, alreadyEnrolled }
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

  const byStatus: SequenceStats['byStatus'] = { active: 0, replied: 0, unsubscribed: 0, completed: 0, failed: 0, meeting: 0, won_lost: 0, bounced: 0 }
  let total = 0
  for (const row of statusRows) {
    byStatus[row.status] = row.count
    total += row.count
  }

  // Step N counts everyone who received it (current_step >= N), not only those still sitting on it:
  // otherwise step 1 drops as soon as people move on to step 2 and looks like it was never sent to all.
  const countByStep = new Map(stepRows.map((r) => [r.step, r.count]))
  const reached = (stepOrder: number) => stepRows.reduce((sum, r) => (r.step >= stepOrder ? sum + r.count : sum), 0)
  const byStep = [
    { step: 0, label: tr('errors.email.notStarted'), count: countByStep.get(0) ?? 0 },
    ...steps.map((s) => ({ step: s.stepOrder, label: `Pas ${s.stepOrder}`, count: reached(s.stepOrder) })),
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
export async function stopSequencesForReplyFrom(email: string): Promise<{ id: string; recipientEmail: string }[]> {
  const normalized = email.trim().toLowerCase()
  const domain = normalized.split('@')[1] ?? ''
  const domainMatchAllowed = domain !== '' && !isPublicEmailDomain(domain)
  return db
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
    .returning({ id: emailSequenceEnrollments.id, recipientEmail: emailSequenceEnrollments.recipientEmail })
}

/**
 * Unsubscribe or bounce: every active enrollment on exactly this address stops at once, not when
 * its next step falls due. Exact match, unlike a reply, which also matches the company domain.
 */
export async function stopEnrollmentsForAddress(address: string, status: 'unsubscribed' | 'bounced'): Promise<number> {
  const rows = await db
    .update(emailSequenceEnrollments)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(emailSequenceEnrollments.status, 'active'),
        isNull(emailSequenceEnrollments.deletedAt),
        sql`lower(trim(${emailSequenceEnrollments.recipientEmail})) = lower(trim(${address}))`,
      ),
    )
    .returning({ id: emailSequenceEnrollments.id })
  return rows.length
}

/** A won/lost stage or a meeting ends the prospect's enrollments in the sequences that asked for it. */
export async function stopEnrollmentsForProspect(prospectId: string, reason: 'won_lost' | 'meeting'): Promise<number> {
  const flag = reason === 'won_lost' ? emailSequences.stopOnWonLost : emailSequences.stopOnMeeting
  const rows = await db
    .update(emailSequenceEnrollments)
    .set({ status: reason, updatedAt: new Date() })
    .where(
      and(
        eq(emailSequenceEnrollments.prospectId, prospectId),
        eq(emailSequenceEnrollments.status, 'active'),
        isNull(emailSequenceEnrollments.deletedAt),
        inArray(emailSequenceEnrollments.sequenceId, db.select({ id: emailSequences.id }).from(emailSequences).where(eq(flag, true))),
      ),
    )
    .returning({ id: emailSequenceEnrollments.id })
  return rows.length
}

/**
 * After a bounce on a sequence send: if the latest `window` sends of that sequence bounce above
 * the threshold, the sequence pauses (the runner skips it) and the admins are told. Under
 * `minSends` the rate means nothing yet. Returns true only for the call that paused it.
 */
export async function pauseSequenceIfBouncing(enrollmentId: string): Promise<boolean> {
  const [sequence] = await db
    .select({ id: emailSequences.id, name: emailSequences.name, pausedAt: emailSequences.pausedAt })
    .from(emailSequenceEnrollments)
    .innerJoin(emailSequences, eq(emailSequences.id, emailSequenceEnrollments.sequenceId))
    .where(eq(emailSequenceEnrollments.id, enrollmentId))
  if (!sequence || sequence.pausedAt) return false

  const { threshold, minSends, window } = await getSequenceBouncePause()
  const recent = db
    .select({ status: emailSends.status })
    .from(emailSends)
    .innerJoin(emailSequenceEnrollments, eq(emailSequenceEnrollments.id, emailSends.sequenceEnrollmentId))
    .where(and(eq(emailSequenceEnrollments.sequenceId, sequence.id), isNull(emailSends.deletedAt), sql`${emailSends.status} NOT IN ('scheduled', 'cancelled')`))
    .orderBy(desc(emailSends.createdAt))
    .limit(window)
    .as('recent')
  const [counts] = await db
    .select({ total: sql<number>`count(*)::int`, bounced: sql<number>`(count(*) FILTER (WHERE ${recent.status} = 'bounced'))::int` })
    .from(recent)
  const total = counts?.total ?? 0
  if (total < minSends) return false
  const rate = (counts?.bounced ?? 0) / total
  if (rate <= threshold) return false

  const [paused] = await db
    .update(emailSequences)
    .set({ pausedAt: new Date(), pausedReason: `BOUNCE_RATE:${rate.toFixed(3)}:${total}`, updatedAt: new Date() })
    .where(and(eq(emailSequences.id, sequence.id), isNull(emailSequences.pausedAt)))
    .returning({ id: emailSequences.id })
  if (!paused) return false

  await notify(await activeAdminIds(), {
    kind: 'email.sequence_paused',
    title: trFor(config.defaultLocale, 'errors.email.sequencePaused', { name: sequence.name, percent: Math.round(rate * 100) }),
    url: '/email',
    entityType: 'email_sequence',
    entityId: sequence.id,
  })
  return true
}

export interface SequenceDiagnostics {
  steps: Array<
    | { stepId: string; order: number; kind: 'email'; variants: Array<{ variant: 'A' | 'B'; sent: number; opened: number; clicked: number; replied: number; bounced: number }> }
    | { stepId: string; order: number; kind: Exclude<SequenceStepRow['kind'], 'email'>; reached: number }
  >
  paused: { at: string; reason: string | null } | null
  /** The auto-pause rule, so the band can show the line a bounce rate is measured against. */
  bouncePause: SequenceBouncePause
}

/**
 * Per step and A/B variant: sent / opened / clicked / bounced come from `email_sends` (GROUP BY).
 * `replied` is an approximation: the replied enrollments whose LAST send was that step and
 * variant (a reply carries no link to the send it answers). Non-email steps create a task, and
 * tasks keep no link back to the step, so for them only `reached` is reported: how many
 * enrollments got past the step (current_step >= order).
 */
export async function getSequenceDiagnostics(sequenceId: string): Promise<SequenceDiagnostics | null> {
  const [sequence] = await db
    .select({ pausedAt: emailSequences.pausedAt, pausedReason: emailSequences.pausedReason })
    .from(emailSequences)
    .where(and(eq(emailSequences.id, sequenceId), isNull(emailSequences.deletedAt)))
  if (!sequence) return null

  const [steps, sendRows, repliedRows, reachedRows] = await Promise.all([
    db
      .select()
      .from(emailSequenceSteps)
      .where(and(eq(emailSequenceSteps.sequenceId, sequenceId), isNull(emailSequenceSteps.deletedAt)))
      .orderBy(asc(emailSequenceSteps.stepOrder)),
    db
      .select({
        stepId: emailSends.sequenceStepId,
        variant: emailSends.variant,
        sent: sql<number>`count(*)::int`,
        opened: sql<number>`(count(*) FILTER (WHERE ${emailSends.openedAt} IS NOT NULL))::int`,
        clicked: sql<number>`(count(*) FILTER (WHERE ${emailSends.clickedAt} IS NOT NULL))::int`,
        bounced: sql<number>`(count(*) FILTER (WHERE ${emailSends.status} = 'bounced'))::int`,
      })
      .from(emailSends)
      .innerJoin(emailSequenceEnrollments, eq(emailSequenceEnrollments.id, emailSends.sequenceEnrollmentId))
      .where(and(eq(emailSequenceEnrollments.sequenceId, sequenceId), isNull(emailSends.deletedAt), sql`${emailSends.status} NOT IN ('scheduled', 'cancelled')`))
      .groupBy(emailSends.sequenceStepId, emailSends.variant),
    db.execute<{ step_id: string | null; variant: 'A' | 'B' | null; replied: number }>(sql`
      SELECT last_send."sequence_step_id" AS step_id, last_send."variant" AS variant, count(*)::int AS replied
        FROM ${emailSequenceEnrollments} e
        CROSS JOIN LATERAL (
          SELECT s."sequence_step_id", s."variant" FROM ${emailSends} s
           WHERE s."sequence_enrollment_id" = e."id" AND s."deleted_at" IS NULL
           ORDER BY s."created_at" DESC LIMIT 1
        ) last_send
       WHERE e."sequence_id" = ${sequenceId} AND e."status" = 'replied' AND e."deleted_at" IS NULL
       GROUP BY 1, 2`),
    db
      .select({ step: emailSequenceEnrollments.currentStep, count: sql<number>`count(*)::int` })
      .from(emailSequenceEnrollments)
      .where(and(eq(emailSequenceEnrollments.sequenceId, sequenceId), isNull(emailSequenceEnrollments.deletedAt)))
      .groupBy(emailSequenceEnrollments.currentStep),
  ])

  const key = (stepId: string | null, variant: string | null) => `${stepId}:${variant ?? 'A'}`
  const sendsByKey = new Map(sendRows.map((r) => [key(r.stepId, r.variant), r]))
  const repliedByKey = new Map(Array.from(repliedRows).map((r) => [key(r.step_id, r.variant), r.replied]))

  return {
    steps: steps.map((step) => {
      if (step.kind !== 'email') {
        return { stepId: step.id, order: step.stepOrder, kind: step.kind, reached: reachedRows.reduce((sum, r) => (r.step >= step.stepOrder ? sum + r.count : sum), 0) }
      }
      const variants: Array<'A' | 'B'> = step.variantBTemplateId || sendsByKey.has(key(step.id, 'B')) ? ['A', 'B'] : ['A']
      return {
        stepId: step.id,
        order: step.stepOrder,
        kind: 'email' as const,
        variants: variants.map((variant) => {
          const row = sendsByKey.get(key(step.id, variant))
          return {
            variant,
            sent: row?.sent ?? 0,
            opened: row?.opened ?? 0,
            clicked: row?.clicked ?? 0,
            replied: repliedByKey.get(key(step.id, variant)) ?? 0,
            bounced: row?.bounced ?? 0,
          }
        }),
      }
    }),
    paused: sequence.pausedAt ? { at: sequence.pausedAt.toISOString(), reason: sequence.pausedReason } : null,
    bouncePause: await getSequenceBouncePause(),
  }
}
