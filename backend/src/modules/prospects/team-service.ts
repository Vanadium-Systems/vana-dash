import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { dashboardConfig, prospectCollaborators, prospectNotes, prospects, prospectTransferRequests, users } from '../../shared/db/schema/index.js'
import { recordAudit } from '../../shared/lib/audit.js'
import { tr } from '../../shared/lib/i18n.js'
import { notify } from '../../shared/lib/notify.js'
import { canReassign, findVisibleProspect, ownerNameOf, ProspectNotYoursError, visibleProspectsWhere } from '../../shared/lib/prospect-access.js'
import { loadSessionUser, userName, type SessionUser } from '../../shared/lib/session.js'
import { noteHooks } from './crm-service.js'
import type { CollaboratorBodySchema, CreateTransferRequestSchema, ReleaseSettingsSchema, TransferProspectsSchema } from './team-schema.js'

type Me = SessionUser
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type ProspectRow = typeof prospects.$inferSelect

export class ProspectTakenError extends Error {
  readonly code = 'PROSPECT_TAKEN'
  constructor(public readonly ownerName: string | null) {
    super('PROSPECT_TAKEN')
  }
}
export class RequestExistsError extends Error {
  readonly code = 'REQUEST_EXISTS'
}
export class RequestDecidedError extends Error {
  readonly code = 'REQUEST_DECIDED'
}
export class RequestNotAllowedError extends Error {
  readonly code = 'REQUEST_NOT_ALLOWED'
}
export class RequestInvalidError extends Error {
  readonly code = 'REQUEST_INVALID'
}
export class InvalidRecipientError extends Error {
  readonly code = 'INVALID_RECIPIENT'
  constructor(public readonly what: 'recipient' | 'collaborator') {
    super('INVALID_RECIPIENT')
  }
}

const clientsUrl = (prospectId: string) => `/clients?prospect=${prospectId}`

function isUniqueViolation(err: unknown): boolean {
  const candidate = err as { code?: string; cause?: { code?: string } } | null
  return candidate?.code === '23505' || candidate?.cause?.code === '23505'
}

async function assertActiveUser(userId: string, what: 'recipient' | 'collaborator') {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.status, 'active'), isNull(users.deletedAt)))
  if (!row) throw new InvalidRecipientError(what)
}

/** Everyone who may assign prospects. The team is a handful of people, so the session loader
 *  per person is cheaper than a second way of resolving roles into features. */
async function usersWithRepartizare(): Promise<string[]> {
  const active = await db.select({ id: users.id }).from(users).where(and(eq(users.status, 'active'), isNull(users.deletedAt)))
  const sessions = await Promise.all(active.map((row) => loadSessionUser(row.id)))
  return sessions.filter((s): s is SessionUser => s !== null && canReassign(s)).map((s) => s.id)
}

// ── Mentions ─────────────────────────────────────────────────────────────────

// createNote already kept only the people who can open the prospect, so the hook just tells them.
noteHooks.afterCreate = async (note, me) => {
  if (note.mentions.length === 0) return
  const [prospect] = await db.select({ name: prospects.name }).from(prospects).where(eq(prospects.id, note.prospectId))
  if (!prospect) return
  await notify(note.mentions, {
    kind: 'clienti.mention',
    title: tr('push.clienti.mention', { author: userName(me), company: prospect.name }),
    url: clientsUrl(note.prospectId),
    entityType: 'prospect',
    entityId: note.prospectId,
    exceptUserId: me.id,
  })
}

// ── Claim and release ────────────────────────────────────────────────────────

export async function claimProspect(me: Me, id: string) {
  const prospect = await findVisibleProspect(me, id)
  if (!prospect) {
    // Free a moment ago, taken now: the loser of a race no longer sees it, but should hear "taken", not "not found".
    const [row] = await db.select({ assignedUserId: prospects.assignedUserId }).from(prospects).where(and(eq(prospects.id, id), isNull(prospects.deletedAt)))
    if (row?.assignedUserId) throw new ProspectTakenError(await ownerNameOf(row.assignedUserId))
    return undefined
  }
  if (prospect.assignedUserId) throw new ProspectTakenError(await ownerNameOf(prospect.assignedUserId))

  const now = new Date()
  // The WHERE is the lock: of two people pressing at once, one update matches and the other none.
  const [claimed] = await db
    .update(prospects)
    .set({ assignedUserId: me.id, claimedAt: now, lastActivityAt: now, updatedAt: now })
    .where(and(eq(prospects.id, id), isNull(prospects.assignedUserId), isNull(prospects.deletedAt)))
    .returning()
  if (!claimed) {
    const [current] = await db.select({ assignedUserId: prospects.assignedUserId }).from(prospects).where(eq(prospects.id, id))
    throw new ProspectTakenError(await ownerNameOf(current?.assignedUserId ?? null))
  }
  await recordAudit({ action: 'prospect.revendicat', entityType: 'prospect', entityId: id, changes: { assignedUserId: [null, me.id] } })
  return claimed
}

export async function releaseProspect(me: Me, id: string) {
  const prospect = await findVisibleProspect(me, id)
  if (!prospect) return undefined
  if (prospect.assignedUserId !== me.id && !canReassign(me)) throw new ProspectNotYoursError(await ownerNameOf(prospect.assignedUserId))
  if (!prospect.assignedUserId) return prospect
  const [released] = await db
    .update(prospects)
    .set({ assignedUserId: null, claimedAt: null, updatedAt: new Date() })
    .where(eq(prospects.id, id))
    .returning()
  await recordAudit({ action: 'prospect.eliberat', entityType: 'prospect', entityId: id, changes: { assignedUserId: [prospect.assignedUserId, null] } })
  return released
}

// ── Transfer ─────────────────────────────────────────────────────────────────

async function applyTransfer(tx: Tx, me: Me, rows: ProspectRow[], toUserId: string, note?: string) {
  const now = new Date()
  // Fresh activity too: the new owner must not inherit the old owner's idle clock.
  await tx
    .update(prospects)
    .set({ assignedUserId: toUserId, claimedAt: now, lastActivityAt: now, updatedAt: now })
    .where(inArray(prospects.id, rows.map((r) => r.id)))
  if (note) {
    await tx.insert(prospectNotes).values(rows.map((r) => ({ prospectId: r.id, authorUserId: me.id, body: tr('push.clienti.handoverNote', { note }) })))
  }
}

async function auditTransfer(rows: ProspectRow[], toUserId: string) {
  for (const row of rows) {
    await recordAudit({ action: 'prospect.transferat', entityType: 'prospect', entityId: row.id, changes: { assignedUserId: [row.assignedUserId, toUserId] } })
  }
}

export type SkipReason = 'notFound' | 'notYours' | 'alreadyThere'

export async function transferProspects(me: Me, input: z.infer<typeof TransferProspectsSchema>) {
  await assertActiveUser(input.toUserId, 'recipient')
  const ids = [...new Set(input.ids)]
  const visible = await db
    .select()
    .from(prospects)
    .where(and(inArray(prospects.id, ids), isNull(prospects.deletedAt), visibleProspectsWhere(me)))
  const byId = new Map(visible.map((row) => [row.id, row]))

  const skipped: Array<{ id: string; reason: SkipReason }> = []
  const movable: ProspectRow[] = []
  for (const id of ids) {
    const row = byId.get(id)
    if (!row) skipped.push({ id, reason: 'notFound' })
    else if (row.assignedUserId === input.toUserId) skipped.push({ id, reason: 'alreadyThere' })
    else if (row.assignedUserId !== me.id && !canReassign(me)) skipped.push({ id, reason: 'notYours' })
    else movable.push(row)
  }
  // A bulk move keeps going past someone else's prospects; when only those were picked, saying
  // "nothing happened" would hide that the person lacks clienti.repartizare.
  const notYours = visible.find((row) => skipped.some((s) => s.id === row.id && s.reason === 'notYours'))
  if (movable.length === 0 && notYours) throw new ProspectNotYoursError(await ownerNameOf(notYours.assignedUserId))
  if (movable.length === 0) return { transferred: 0, skipped }

  await db.transaction((tx) => applyTransfer(tx, me, movable, input.toUserId, input.note))
  await auditTransfer(movable, input.toUserId)

  const [first] = movable
  await notify([input.toUserId], {
    kind: 'clienti.transfer',
    title:
      movable.length === 1 && first
        ? tr('push.clienti.transferOne', { company: first.name, from: userName(me) })
        : tr('push.clienti.transferMany', { count: movable.length, from: userName(me) }),
    url: movable.length === 1 && first ? clientsUrl(first.id) : '/clients',
    entityType: movable.length === 1 ? 'prospect' : undefined,
    entityId: movable.length === 1 ? first?.id : undefined,
    exceptUserId: me.id,
  })
  return { transferred: movable.length, skipped }
}

// ── Requests ─────────────────────────────────────────────────────────────────

export async function createTransferRequest(me: Me, prospectId: string, input: z.infer<typeof CreateTransferRequestSchema>) {
  // An access request may name a prospect the person cannot see (the card in Messages), so the
  // lookup is by id; the answer below never says more than "sent".
  const [prospect] =
    input.kind === 'access'
      ? await db.select().from(prospects).where(and(eq(prospects.id, prospectId), isNull(prospects.deletedAt)))
      : [await findVisibleProspect(me, prospectId)]
  if (!prospect) return undefined
  if (prospect.assignedUserId === me.id) throw new RequestInvalidError()
  if (input.kind === 'transfer' && !prospect.assignedUserId) throw new RequestInvalidError()

  let created: typeof prospectTransferRequests.$inferSelect | undefined
  try {
    ;[created] = await db
      .insert(prospectTransferRequests)
      .values({
        prospectId,
        kind: input.kind,
        fromUserId: prospect.assignedUserId,
        toUserId: me.id,
        requestedByUserId: me.id,
        note: input.note ?? null,
      })
      .returning()
  } catch (err) {
    if (isUniqueViolation(err)) throw new RequestExistsError()
    throw err
  }
  if (!created) throw new Error('transfer request insert returned nothing')

  await notify(prospect.assignedUserId ? [prospect.assignedUserId] : await usersWithRepartizare(), {
    kind: 'clienti.request',
    title: tr(input.kind === 'transfer' ? 'push.clienti.requestTransfer' : 'push.clienti.requestAccess', { who: userName(me), company: prospect.name }),
    body: input.note,
    url: clientsUrl(prospectId),
    entityType: 'prospect',
    entityId: prospectId,
    exceptUserId: me.id,
  })
  return { id: created.id, kind: created.kind, status: created.status }
}

export async function decideTransferRequest(me: Me, requestId: string, action: 'accept' | 'refuse' | 'cancel') {
  const [request] = await db.select().from(prospectTransferRequests).where(and(eq(prospectTransferRequests.id, requestId), isNull(prospectTransferRequests.deletedAt)))
  if (!request) return undefined
  const [prospect] = await db.select().from(prospects).where(and(eq(prospects.id, request.prospectId), isNull(prospects.deletedAt)))
  if (!prospect) return undefined

  if (action === 'cancel') {
    if (request.requestedByUserId !== me.id) throw new RequestNotAllowedError()
  } else if (prospect.assignedUserId !== me.id && !canReassign(me)) {
    throw new RequestNotAllowedError()
  }
  if (request.status !== 'pending') throw new RequestDecidedError()
  if (action === 'accept') {
    await assertActiveUser(request.toUserId, 'recipient')
    if (request.kind === 'transfer' && !prospect.assignedUserId) throw new RequestInvalidError()
  }

  const status = action === 'accept' ? 'accepted' : action === 'refuse' ? 'refused' : 'cancelled'
  const decided = await db.transaction(async (tx) => {
    const now = new Date()
    const [row] = await tx
      .update(prospectTransferRequests)
      .set({ status, decidedByUserId: me.id, decidedAt: now, updatedAt: now })
      .where(and(eq(prospectTransferRequests.id, requestId), eq(prospectTransferRequests.status, 'pending')))
      .returning()
    if (!row) throw new RequestDecidedError()
    if (action !== 'accept') return row
    if (request.kind === 'transfer') {
      await applyTransfer(tx, me, [prospect], request.toUserId)
    } else {
      await tx
        .insert(prospectCollaborators)
        .values({ prospectId: prospect.id, userId: request.toUserId, level: 'edit' })
        .onConflictDoUpdate({
          target: [prospectCollaborators.tenantId, prospectCollaborators.prospectId, prospectCollaborators.userId],
          set: { level: 'edit', deletedAt: null, updatedAt: now },
        })
    }
    return row
  })

  const target = { entityType: 'prospect', entityId: prospect.id }
  if (action === 'accept') {
    if (request.kind === 'transfer') await auditTransfer([prospect], request.toUserId)
    else await recordAudit({ action: 'prospect.colaborator.adaugat', entityType: 'prospect', entityId: prospect.id, changes: { collaborator: [null, request.toUserId] } })
    await notify([request.toUserId], { kind: 'clienti.request', title: tr('push.clienti.requestAccepted', { company: prospect.name }), url: clientsUrl(prospect.id), ...target, exceptUserId: me.id })
    if (request.kind === 'transfer' && prospect.assignedUserId) {
      const to = (await ownerNameOf(request.toUserId)) ?? ''
      await notify([prospect.assignedUserId], { kind: 'clienti.request', title: tr('push.clienti.handedOver', { company: prospect.name, to }), url: clientsUrl(prospect.id), ...target, exceptUserId: me.id })
    }
  } else if (action === 'refuse') {
    await notify([request.toUserId], { kind: 'clienti.request', title: tr('push.clienti.requestRefused', { company: prospect.name }), url: clientsUrl(prospect.id), ...target, exceptUserId: me.id })
  } else {
    await notify(prospect.assignedUserId ? [prospect.assignedUserId] : await usersWithRepartizare(), {
      kind: 'clienti.request',
      title: tr('push.clienti.requestCancelled', { who: userName(me), company: prospect.name }),
      url: clientsUrl(prospect.id),
      ...target,
      exceptUserId: me.id,
    })
  }
  return decided
}

export async function listTransferRequests(me: Me, scope: 'incoming' | 'outgoing') {
  const requester = alias(users, 'requester')
  const t = prospectTransferRequests
  const mine =
    scope === 'outgoing'
      ? eq(t.requestedByUserId, me.id)
      : canReassign(me)
        ? sql`true`
        : eq(t.fromUserId, me.id)
  return db
    .select({
      id: t.id,
      prospectId: t.prospectId,
      prospectName: prospects.name,
      kind: t.kind,
      status: t.status,
      note: t.note,
      fromUserId: t.fromUserId,
      toUserId: t.toUserId,
      toName: sql<string | null>`COALESCE(${requester.displayName}, ${requester.email})`,
      createdAt: t.createdAt,
    })
    .from(t)
    .innerJoin(prospects, and(eq(prospects.id, t.prospectId), isNull(prospects.deletedAt)))
    .leftJoin(requester, eq(requester.id, t.toUserId))
    .where(and(eq(t.status, 'pending'), isNull(t.deletedAt), mine))
    .orderBy(desc(t.createdAt))
}

// ── Collaborators ────────────────────────────────────────────────────────────

async function ownedProspect(me: Me, prospectId: string) {
  const prospect = await findVisibleProspect(me, prospectId)
  if (!prospect) return undefined
  if (prospect.assignedUserId !== me.id && !canReassign(me)) throw new ProspectNotYoursError(await ownerNameOf(prospect.assignedUserId))
  return prospect
}

export async function setCollaborator(me: Me, prospectId: string, userId: string, input: z.infer<typeof CollaboratorBodySchema>) {
  const prospect = await ownedProspect(me, prospectId)
  if (!prospect) return undefined
  if (userId === prospect.assignedUserId) throw new InvalidRecipientError('collaborator')
  await assertActiveUser(userId, 'collaborator')

  const [existing] = await db
    .select({ id: prospectCollaborators.id, deletedAt: prospectCollaborators.deletedAt })
    .from(prospectCollaborators)
    .where(and(eq(prospectCollaborators.prospectId, prospectId), eq(prospectCollaborators.userId, userId)))
  const [row] = await db
    .insert(prospectCollaborators)
    .values({ prospectId, userId, level: input.level })
    .onConflictDoUpdate({
      target: [prospectCollaborators.tenantId, prospectCollaborators.prospectId, prospectCollaborators.userId],
      set: { level: input.level, deletedAt: null, updatedAt: new Date() },
    })
    .returning()
  await recordAudit({ action: 'prospect.colaborator.setat', entityType: 'prospect', entityId: prospectId, changes: { collaborator: [existing && !existing.deletedAt ? userId : null, userId], level: [null, input.level] } })
  if (!existing || existing.deletedAt) {
    await notify([userId], {
      kind: 'clienti.collaborator',
      title: tr('push.clienti.collaborator', { who: userName(me), company: prospect.name }),
      url: clientsUrl(prospectId),
      entityType: 'prospect',
      entityId: prospectId,
      exceptUserId: me.id,
    })
  }
  return row
}

export async function removeCollaborator(me: Me, prospectId: string, userId: string) {
  if (!(await ownedProspect(me, prospectId))) return undefined
  const [row] = await db
    .update(prospectCollaborators)
    .set({ deletedAt: new Date() })
    .where(and(eq(prospectCollaborators.prospectId, prospectId), eq(prospectCollaborators.userId, userId), isNull(prospectCollaborators.deletedAt)))
    .returning({ id: prospectCollaborators.id })
  if (row) await recordAudit({ action: 'prospect.colaborator.scos', entityType: 'prospect', entityId: prospectId, changes: { collaborator: [userId, null] } })
  return row
}

// ── Contact check ────────────────────────────────────────────────────────────

/** Who has the prospect and when somebody last touched it: notes, tasks done, emails sent to its
 *  addresses, calls. One query, newest first, so the card shows the answer without a sheet. */
export async function contactCheck(me: Me, prospectId: string) {
  const prospect = await findVisibleProspect(me, prospectId)
  if (!prospect) return undefined
  const rows = await db.execute<{ at: Date; kind: string; person: string | null }>(sql`
    SELECT a.at, a.kind, COALESCE(u.display_name, u.email) AS person
    FROM (
      SELECT n.created_at AS at, 'note' AS kind, n.author_user_id AS by_id
        FROM prospect_notes n WHERE n.prospect_id = ${prospectId} AND n.deleted_at IS NULL
      UNION ALL
      SELECT t.done_at, 'task', t.assignee_user_id
        FROM prospect_tasks t WHERE t.prospect_id = ${prospectId} AND t.done_at IS NOT NULL AND t.deleted_at IS NULL
      UNION ALL
      SELECT s.created_at, 'email', s.sent_by_user_id
        FROM email_sends s
       WHERE s.deleted_at IS NULL AND s.status NOT IN ('scheduled', 'cancelled', 'failed')
         AND lower(s.recipient) IN (
           SELECT cp.value_normalized FROM prospect_contact_points cp
            WHERE cp.prospect_id = ${prospectId} AND cp.kind = 'email' AND cp.deleted_at IS NULL)
      UNION ALL
      SELECT c.created_at, 'call', NULL::uuid
        FROM calls c WHERE c.prospect_id = ${prospectId} AND c.deleted_at IS NULL
    ) a
    LEFT JOIN users u ON u.id = a.by_id
    ORDER BY a.at DESC
    LIMIT 1`)
  const last = rows[0]
  return {
    ownerName: await ownerNameOf(prospect.assignedUserId),
    claimedAt: prospect.claimedAt,
    lastActivityAt: last?.at ?? null,
    lastActivityKind: last?.kind ?? null,
    lastActivityBy: last?.person ?? null,
  }
}

// ── Automatic release setting ────────────────────────────────────────────────

const RELEASE_KEY = 'clienti.release'
export type ReleaseSettings = z.infer<typeof ReleaseSettingsSchema>
const DEFAULT_RELEASE: ReleaseSettings = { enabled: false, idleDays: 30, warnDays: 5 }

export async function getReleaseSettings(): Promise<ReleaseSettings> {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, RELEASE_KEY))
  return row ? { ...DEFAULT_RELEASE, ...(row.value as Partial<ReleaseSettings>) } : DEFAULT_RELEASE
}

export async function setReleaseSettings(input: ReleaseSettings): Promise<ReleaseSettings> {
  const before = await getReleaseSettings()
  await db
    .insert(dashboardConfig)
    .values({ key: RELEASE_KEY, value: input })
    .onConflictDoUpdate({ target: [dashboardConfig.tenantId, dashboardConfig.key], set: { value: sql`excluded.value`, updatedAt: new Date() } })
  await recordAudit({ action: 'prospect.eliberare.setari', entityType: 'settings', changes: { release: [before, input] } })
  return input
}
