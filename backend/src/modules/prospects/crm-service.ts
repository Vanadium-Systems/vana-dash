import { and, asc, desc, eq, getTableColumns, isNull, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import { getCountryPack } from '../../countries/index.js'
import { db } from '../../shared/db/client.js'
import { calendarEvents, prospectContactPoints, prospectNotes, prospectPeople, prospects, prospectTasks, users } from '../../shared/db/schema/index.js'
import { recordAudit } from '../../shared/lib/audit.js'
import { createCalendarEvent } from '../../shared/lib/calendar-write.js'
import { getCompany, getCompanyTimeZone } from '../../shared/lib/company.js'
import { canEditProspect, canReassign, findVisibleProspect, ownerNameOf, ProspectNotYoursError, requireEditableProspect, visibleProspectsWhere } from '../../shared/lib/prospect-access.js'
import { emitProspectEvent } from '../../shared/lib/prospect-events.js'
import { loadSessionUser, type SessionUser } from '../../shared/lib/session.js'
import type {
  CompleteTaskSchema,
  CreateContactPointSchema,
  CreateNoteSchema,
  CreatePersonSchema,
  CreateProspectTaskSchema,
  UpdateContactPointSchema,
  UpdateNoteSchema,
  UpdatePersonSchema,
  UpdateProspectTaskSchema,
} from './schema.js'
import { TASK_TABS } from './schema.js'
import { InvalidAssigneeError, normalizeEmail, refreshScore } from './service.js'

type Me = SessionUser
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export class ContactExistsError extends Error {
  readonly code = 'CONTACT_EXISTS'
}
export class NoteNotYoursError extends Error {
  readonly code = 'NOTE_NOT_YOURS'
}
export class ForeignRefError extends Error {
  constructor(public readonly what: 'person' | 'contactPoint') {
    super('FOREIGN_REF')
  }
}

const CALENDAR_SLOT_MS = 30 * 60 * 1000

// ── People ───────────────────────────────────────────────────────────────────

export async function listPeople(me: Me, prospectId: string) {
  if (!(await findVisibleProspect(me, prospectId))) return undefined
  return db
    .select()
    .from(prospectPeople)
    .where(and(eq(prospectPeople.prospectId, prospectId), isNull(prospectPeople.deletedAt)))
    .orderBy(asc(prospectPeople.position), asc(prospectPeople.createdAt))
}

export async function createPerson(me: Me, prospectId: string, input: z.infer<typeof CreatePersonSchema>) {
  if (!(await requireEditableProspect(me, prospectId))) return undefined
  const [row] = await db.insert(prospectPeople).values({ ...input, prospectId }).returning()
  await refreshScore(prospectId)
  return row
}

export async function updatePerson(me: Me, prospectId: string, personId: string, input: z.infer<typeof UpdatePersonSchema>) {
  if (!(await requireEditableProspect(me, prospectId))) return undefined
  const [row] = await db
    .update(prospectPeople)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(prospectPeople.id, personId), eq(prospectPeople.prospectId, prospectId), isNull(prospectPeople.deletedAt)))
    .returning()
  if (row) await refreshScore(prospectId)
  return row
}

export async function deletePerson(me: Me, prospectId: string, personId: string) {
  if (!(await requireEditableProspect(me, prospectId))) return undefined
  const now = new Date()
  const row = await db.transaction(async (tx) => {
    const [deleted] = await tx
      .update(prospectPeople)
      .set({ deletedAt: now })
      .where(and(eq(prospectPeople.id, personId), eq(prospectPeople.prospectId, prospectId), isNull(prospectPeople.deletedAt)))
      .returning({ id: prospectPeople.id })
    // The person's phones and emails go with them; left behind they would point at a deleted row.
    if (deleted) {
      await tx
        .update(prospectContactPoints)
        .set({ deletedAt: now })
        .where(and(eq(prospectContactPoints.personId, personId), isNull(prospectContactPoints.deletedAt)))
    }
    return deleted
  })
  if (row) await refreshScore(prospectId)
  return row
}

async function assertPersonOf(prospectId: string, personId: string | null | undefined) {
  if (!personId) return
  const [row] = await db
    .select({ id: prospectPeople.id })
    .from(prospectPeople)
    .where(and(eq(prospectPeople.id, personId), eq(prospectPeople.prospectId, prospectId), isNull(prospectPeople.deletedAt)))
  if (!row) throw new ForeignRefError('person')
}

// ── Contact points ───────────────────────────────────────────────────────────

async function normalizeContact(kind: 'phone' | 'email', value: string) {
  if (kind === 'email') return normalizeEmail(value)
  return getCountryPack((await getCompany()).country).normalizePhone(value)
}

async function contactExists(prospectId: string, kind: string, valueNormalized: string, exceptId?: string) {
  const [row] = await db
    .select({ id: prospectContactPoints.id })
    .from(prospectContactPoints)
    .where(
      and(
        eq(prospectContactPoints.prospectId, prospectId),
        eq(prospectContactPoints.kind, kind as 'phone' | 'email'),
        eq(prospectContactPoints.valueNormalized, valueNormalized),
        isNull(prospectContactPoints.deletedAt),
        exceptId ? sql`${prospectContactPoints.id} <> ${exceptId}` : undefined,
      ),
    )
  return Boolean(row)
}

// Primary is per kind and per owner: a person's primary phone does not demote the company's.
function demoteOtherPrimaries(tx: Tx, point: { id: string; prospectId: string; kind: 'phone' | 'email'; personId: string | null }) {
  return tx
    .update(prospectContactPoints)
    .set({ isPrimary: false, updatedAt: new Date() })
    .where(
      and(
        eq(prospectContactPoints.prospectId, point.prospectId),
        eq(prospectContactPoints.kind, point.kind),
        eq(prospectContactPoints.isPrimary, true),
        isNull(prospectContactPoints.deletedAt),
        sql`${prospectContactPoints.id} <> ${point.id}`,
        sql`${prospectContactPoints.personId} IS NOT DISTINCT FROM ${point.personId}`,
      ),
    )
}

export async function createContactPoint(me: Me, prospectId: string, input: z.infer<typeof CreateContactPointSchema>) {
  if (!(await requireEditableProspect(me, prospectId))) return undefined
  await assertPersonOf(prospectId, input.personId)
  const valueNormalized = await normalizeContact(input.kind, input.value)
  if (await contactExists(prospectId, input.kind, valueNormalized)) throw new ContactExistsError()

  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(prospectContactPoints)
      .values({
        prospectId,
        personId: input.personId ?? null,
        kind: input.kind,
        value: input.value,
        valueNormalized,
        label: input.label ?? null,
        isPrimary: input.isPrimary ?? false,
      })
      .returning()
    if (!created) throw new Error('contact point insert returned nothing')
    if (created.isPrimary) await demoteOtherPrimaries(tx, created)
    return created
  })
  await refreshScore(prospectId)
  await recordAudit({ action: 'prospect.contact.adaugat', entityType: 'prospect', entityId: prospectId, changes: { [input.kind]: [null, row.value] } })
  return row
}

export async function updateContactPoint(me: Me, prospectId: string, cpId: string, input: z.infer<typeof UpdateContactPointSchema>) {
  if (!(await requireEditableProspect(me, prospectId))) return undefined
  const [existing] = await db
    .select()
    .from(prospectContactPoints)
    .where(and(eq(prospectContactPoints.id, cpId), eq(prospectContactPoints.prospectId, prospectId), isNull(prospectContactPoints.deletedAt)))
  if (!existing) return undefined
  if (input.personId !== undefined) await assertPersonOf(prospectId, input.personId)

  let valueNormalized: string | undefined
  if (input.value !== undefined) {
    valueNormalized = await normalizeContact(existing.kind, input.value)
    if (await contactExists(prospectId, existing.kind, valueNormalized, cpId)) throw new ContactExistsError()
  }
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(prospectContactPoints)
      .set({ ...input, valueNormalized, updatedAt: new Date() })
      .where(eq(prospectContactPoints.id, cpId))
      .returning()
    if (updated?.isPrimary) await demoteOtherPrimaries(tx, updated)
    return updated
  })
  await refreshScore(prospectId)
  await recordAudit({
    action: 'prospect.contact.modificat',
    entityType: 'prospect',
    entityId: prospectId,
    changes: { [existing.kind]: [existing.value, row?.value ?? existing.value] },
  })
  return row
}

export async function deleteContactPoint(me: Me, prospectId: string, cpId: string) {
  if (!(await requireEditableProspect(me, prospectId))) return undefined
  const [row] = await db
    .update(prospectContactPoints)
    .set({ deletedAt: new Date() })
    .where(and(eq(prospectContactPoints.id, cpId), eq(prospectContactPoints.prospectId, prospectId), isNull(prospectContactPoints.deletedAt)))
    .returning()
  if (!row) return undefined
  await refreshScore(prospectId)
  await recordAudit({ action: 'prospect.contact.sters', entityType: 'prospect', entityId: prospectId, changes: { [row.kind]: [row.value, null] } })
  return row
}

// ── Notes ────────────────────────────────────────────────────────────────────

type NoteRow = typeof prospectNotes.$inferSelect

/** Filled by the notification module (mentions); this file only stores the note. */
export const noteHooks: { afterCreate: (note: NoteRow, me: SessionUser) => Promise<void> } = {
  afterCreate: async () => {},
}

/** Only people who can open the prospect may be mentioned: a mention must not leak it. */
async function mentionableUsers(prospectId: string, ids: string[] | undefined): Promise<string[]> {
  const unique = [...new Set(ids ?? [])]
  const checked = await Promise.all(
    unique.map(async (userId) => {
      const user = await loadSessionUser(userId)
      if (!user || user.status !== 'active' || !user.features.includes('clienti.view')) return null
      return (await findVisibleProspect(user, prospectId)) ? userId : null
    }),
  )
  return checked.filter((id): id is string => id !== null)
}

export async function listNotes(me: Me, prospectId: string) {
  if (!(await findVisibleProspect(me, prospectId))) return undefined
  return db
    .select({
      id: prospectNotes.id,
      prospectId: prospectNotes.prospectId,
      authorUserId: prospectNotes.authorUserId,
      authorName: sql<string | null>`COALESCE(${users.displayName}, ${users.email})`,
      body: prospectNotes.body,
      mentions: prospectNotes.mentions,
      pinned: prospectNotes.pinned,
      createdAt: prospectNotes.createdAt,
      updatedAt: prospectNotes.updatedAt,
    })
    .from(prospectNotes)
    .leftJoin(users, eq(users.id, prospectNotes.authorUserId))
    .where(and(eq(prospectNotes.prospectId, prospectId), isNull(prospectNotes.deletedAt)))
    .orderBy(desc(prospectNotes.pinned), desc(prospectNotes.createdAt))
}

// One pinned note per prospect: pinning a note unpins the rest.
function unpinOthers(tx: Tx, prospectId: string, keepId: string) {
  return tx
    .update(prospectNotes)
    .set({ pinned: false, updatedAt: new Date() })
    .where(and(eq(prospectNotes.prospectId, prospectId), eq(prospectNotes.pinned, true), isNull(prospectNotes.deletedAt), sql`${prospectNotes.id} <> ${keepId}`))
}

/** A visible prospect is enough: writing a note is not editing the prospect. */
export async function createNote(me: Me, prospectId: string, input: z.infer<typeof CreateNoteSchema>) {
  if (!(await findVisibleProspect(me, prospectId))) return undefined
  const mentions = await mentionableUsers(prospectId, input.mentions)
  const note = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(prospectNotes)
      .values({ prospectId, authorUserId: me.id, body: input.body, pinned: input.pinned ?? false, mentions })
      .returning()
    if (!created) throw new Error('note insert returned nothing')
    if (created.pinned) await unpinOthers(tx, prospectId, created.id)
    await tx.update(prospects).set({ lastActivityAt: new Date() }).where(eq(prospects.id, prospectId))
    return created
  })
  await noteHooks.afterCreate(note, me)
  return note
}

export async function updateNote(me: Me, prospectId: string, noteId: string, input: z.infer<typeof UpdateNoteSchema>) {
  if (!(await findVisibleProspect(me, prospectId))) return undefined
  const [existing] = await db
    .select()
    .from(prospectNotes)
    .where(and(eq(prospectNotes.id, noteId), eq(prospectNotes.prospectId, prospectId), isNull(prospectNotes.deletedAt)))
  if (!existing) return undefined
  if (existing.authorUserId !== me.id) throw new NoteNotYoursError()

  const mentions = input.mentions === undefined ? undefined : await mentionableUsers(prospectId, input.mentions)
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(prospectNotes)
      .set({ body: input.body, pinned: input.pinned, mentions, updatedAt: new Date() })
      .where(eq(prospectNotes.id, noteId))
      .returning()
    if (updated?.pinned) await unpinOthers(tx, prospectId, noteId)
    return updated
  })
}

export async function deleteNote(me: Me, prospectId: string, noteId: string) {
  if (!(await findVisibleProspect(me, prospectId))) return undefined
  const [existing] = await db
    .select({ authorUserId: prospectNotes.authorUserId })
    .from(prospectNotes)
    .where(and(eq(prospectNotes.id, noteId), eq(prospectNotes.prospectId, prospectId), isNull(prospectNotes.deletedAt)))
  if (!existing) return undefined
  if (existing.authorUserId !== me.id) throw new NoteNotYoursError()
  const [row] = await db.update(prospectNotes).set({ deletedAt: new Date() }).where(eq(prospectNotes.id, noteId)).returning({ id: prospectNotes.id })
  return row
}

// ── Tasks on a prospect ──────────────────────────────────────────────────────

const openTask = and(isNull(prospectTasks.doneAt), isNull(prospectTasks.skippedAt), isNull(prospectTasks.deletedAt))

export async function listProspectTasks(me: Me, prospectId: string) {
  if (!(await findVisibleProspect(me, prospectId))) return undefined
  return db
    .select({
      ...getTableColumns(prospectTasks),
      personName: prospectPeople.name,
      assigneeName: sql<string | null>`COALESCE(${users.displayName}, ${users.email})`,
    })
    .from(prospectTasks)
    .leftJoin(prospectPeople, eq(prospectPeople.id, prospectTasks.personId))
    .leftJoin(users, eq(users.id, prospectTasks.assigneeUserId))
    .where(and(eq(prospectTasks.prospectId, prospectId), isNull(prospectTasks.deletedAt)))
    .orderBy(sql`${prospectTasks.doneAt} IS NOT NULL`, asc(prospectTasks.dueAt))
}

/** Assigning to a colleague needs `clienti.repartizare` or owning the prospect; the colleague must be active. */
async function assertAssignee(me: Me, prospect: { assignedUserId: string | null }, assigneeUserId: string) {
  if (assigneeUserId !== me.id && !canReassign(me) && prospect.assignedUserId !== me.id) throw new InvalidAssigneeError()
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, assigneeUserId), eq(users.status, 'active'), isNull(users.deletedAt)))
  if (!row) throw new InvalidAssigneeError()
}

const slotOf = (dueAt: Date) => ({ startAt: dueAt, endAt: new Date(dueAt.getTime() + CALENDAR_SLOT_MS) })

// `me.id` null = created by an automation, no author.
export async function insertTask(
  tx: Tx,
  me: { id: string | null },
  prospectId: string,
  assigneeUserId: string,
  input: Pick<z.infer<typeof CreateProspectTaskSchema>, 'kind' | 'title' | 'dueAt' | 'priority' | 'addToCalendar'> & {
    description?: string | null
    personId?: string | null
  },
) {
  const addToCalendar = input.addToCalendar ?? (input.kind === 'call' || input.kind === 'meeting')
  const calendarEventId = addToCalendar
    ? await createCalendarEvent({ ownerUserId: assigneeUserId, title: input.title, description: input.description, ...slotOf(input.dueAt) }, tx)
    : null
  const [task] = await tx
    .insert(prospectTasks)
    .values({
      prospectId,
      personId: input.personId ?? null,
      assigneeUserId,
      createdByUserId: me.id,
      kind: input.kind,
      title: input.title,
      description: input.description ?? null,
      dueAt: input.dueAt,
      priority: input.priority ?? 'medium',
      calendarEventId,
    })
    .returning()
  if (!task) throw new Error('task insert returned nothing')
  return task
}

export async function createProspectTask(me: Me, prospectId: string, input: z.infer<typeof CreateProspectTaskSchema>) {
  const prospect = await requireEditableProspect(me, prospectId)
  if (!prospect) return undefined
  const assigneeUserId = input.assigneeUserId ?? me.id
  await assertAssignee(me, prospect, assigneeUserId)
  await assertPersonOf(prospectId, input.personId)
  const task = await db.transaction((tx) => insertTask(tx, me, prospectId, assigneeUserId, input))
  // A meeting on the books ends the sequences that stop on a meeting.
  if (task.kind === 'meeting') emitProspectEvent('meeting.booked', { prospectId, at: task.dueAt })
  return task
}

export async function updateProspectTask(me: Me, prospectId: string, taskId: string, input: z.infer<typeof UpdateProspectTaskSchema>) {
  const prospect = await requireEditableProspect(me, prospectId)
  if (!prospect) return undefined
  const [existing] = await db
    .select()
    .from(prospectTasks)
    .where(and(eq(prospectTasks.id, taskId), eq(prospectTasks.prospectId, prospectId), isNull(prospectTasks.deletedAt)))
  if (!existing) return undefined
  if (input.assigneeUserId && input.assigneeUserId !== existing.assigneeUserId) await assertAssignee(me, prospect, input.assigneeUserId)
  if (input.personId) await assertPersonOf(prospectId, input.personId)

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(prospectTasks)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(prospectTasks.id, taskId))
      .returning()
    // The calendar entry follows the task, or it would keep the old time and title.
    if (updated?.calendarEventId) {
      await tx
        .update(calendarEvents)
        .set({ title: updated.title, ...slotOf(updated.dueAt), ownerUserId: updated.assigneeUserId, updatedAt: new Date() })
        .where(eq(calendarEvents.id, updated.calendarEventId))
    }
    return updated
  })
}

export async function deleteProspectTask(me: Me, prospectId: string, taskId: string) {
  if (!(await requireEditableProspect(me, prospectId))) return undefined
  const now = new Date()
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(prospectTasks)
      .set({ deletedAt: now })
      .where(and(eq(prospectTasks.id, taskId), eq(prospectTasks.prospectId, prospectId), isNull(prospectTasks.deletedAt)))
      .returning()
    if (row?.calendarEventId) await tx.update(calendarEvents).set({ deletedAt: now }).where(eq(calendarEvents.id, row.calendarEventId))
    return row
  })
}

/** The assignee, or whoever can edit the prospect, closes the task. A task of a prospect I cannot see is a 404. */
export async function completeTask(me: Me, taskId: string, input: z.infer<typeof CompleteTaskSchema>) {
  const [task] = await db.select().from(prospectTasks).where(and(eq(prospectTasks.id, taskId), isNull(prospectTasks.deletedAt)))
  if (!task) return undefined
  const prospect = await findVisibleProspect(me, task.prospectId)
  if (!prospect) return undefined
  if (task.assigneeUserId !== me.id && !(await canEditProspect(me, prospect))) {
    throw new ProspectNotYoursError(await ownerNameOf(prospect.assignedUserId))
  }
  if (task.doneAt) return { task, nextTask: null }

  const now = new Date()
  const result = await db.transaction(async (tx) => {
    const [done] = await tx
      .update(prospectTasks)
      .set({ doneAt: now, outcome: input.outcome ?? null, outcomeNote: input.outcomeNote ?? null, updatedAt: now })
      .where(and(eq(prospectTasks.id, taskId), isNull(prospectTasks.doneAt)))
      .returning()
    if (!done) return null

    let invalidated = false
    if (input.outcome === 'wrong_number' && input.contactPointId) {
      const marked = await tx
        .update(prospectContactPoints)
        .set({ status: 'invalid', updatedAt: now })
        .where(and(eq(prospectContactPoints.id, input.contactPointId), eq(prospectContactPoints.prospectId, task.prospectId), isNull(prospectContactPoints.deletedAt)))
        .returning({ id: prospectContactPoints.id })
      invalidated = marked.length > 0
    }
    // The follow-up stays with the same owner and person as the task it follows.
    const nextTask = input.nextTask ? await insertTask(tx, me, task.prospectId, task.assigneeUserId, { ...input.nextTask, personId: task.personId }) : null
    await tx
      .update(prospects)
      .set({ lastActivityAt: now, ...(task.kind === 'call' ? { lastContactedAt: now } : {}) })
      .where(eq(prospects.id, task.prospectId))
    return { task: done, nextTask, invalidated }
  })
  if (!result) return { task, nextTask: null }

  if (result.invalidated) await refreshScore(task.prospectId)
  emitProspectEvent('task.done', { taskId, prospectId: task.prospectId, kind: task.kind, outcome: result.task.outcome })
  return { task: result.task, nextTask: result.nextTask }
}

// ── Task page ────────────────────────────────────────────────────────────────

type TaskTab = (typeof TASK_TABS)[number]
interface TaskListInput {
  tab?: TaskTab
  scope?: 'mine' | 'team'
  page?: number
  pageSize?: number
}

/** `team` is for people who can reassign; for anyone else it is the same as `mine`. */
async function taskPageFilter(me: Me, scope: 'mine' | 'team' | undefined) {
  const timeZone = me.tenant?.timeZone ?? (await getCompanyTimeZone())
  const dueDay = sql`(${prospectTasks.dueAt} AT TIME ZONE ${timeZone}::text)::date`
  const today = sql`(now() AT TIME ZONE ${timeZone}::text)::date`
  const base = and(
    openTask,
    isNull(prospects.deletedAt),
    visibleProspectsWhere(me),
    scope === 'team' && canReassign(me) ? undefined : eq(prospectTasks.assigneeUserId, me.id),
  ) as SQL
  return { base, dueDay, today }
}

export async function listTasks(me: Me, input: TaskListInput) {
  const page = Math.max(1, input.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 25))
  const { base, dueDay, today } = await taskPageFilter(me, input.scope)
  const tabWhere: Record<TaskTab, SQL | undefined> = {
    all: undefined,
    call: eq(prospectTasks.kind, 'call'),
    email: eq(prospectTasks.kind, 'email'),
    linkedin: sql`${prospectTasks.kind} LIKE 'linkedin\\_%'`,
    today: sql`${dueDay} = ${today}`,
    overdue: sql`${dueDay} < ${today}`,
  }
  const where = and(base, tabWhere[input.tab ?? 'all'])

  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db
      .select({
        ...getTableColumns(prospectTasks),
        prospectName: prospects.name,
        personName: prospectPeople.name,
        assigneeName: sql<string | null>`COALESCE(${users.displayName}, ${users.email})`,
      })
      .from(prospectTasks)
      .innerJoin(prospects, eq(prospects.id, prospectTasks.prospectId))
      .leftJoin(prospectPeople, eq(prospectPeople.id, prospectTasks.personId))
      .leftJoin(users, eq(users.id, prospectTasks.assigneeUserId))
      .where(where)
      .orderBy(asc(prospectTasks.dueAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(prospectTasks)
      .innerJoin(prospects, eq(prospects.id, prospectTasks.prospectId))
      .where(where),
  ])
  return { rows, total, page, pageSize }
}

export async function taskCounts(me: Me, scope: 'mine' | 'team' | undefined) {
  const { base, dueDay, today } = await taskPageFilter(me, scope)
  const [row] = await db
    .select({
      all: sql<number>`count(*)::int`,
      call: sql<number>`(count(*) FILTER (WHERE ${prospectTasks.kind} = 'call'))::int`,
      email: sql<number>`(count(*) FILTER (WHERE ${prospectTasks.kind} = 'email'))::int`,
      linkedin: sql<number>`(count(*) FILTER (WHERE ${prospectTasks.kind} LIKE 'linkedin\\_%'))::int`,
      today: sql<number>`(count(*) FILTER (WHERE ${dueDay} = ${today}))::int`,
      overdue: sql<number>`(count(*) FILTER (WHERE ${dueDay} < ${today}))::int`,
    })
    .from(prospectTasks)
    .innerJoin(prospects, eq(prospects.id, prospectTasks.prospectId))
    .where(base)
  return row ?? { all: 0, call: 0, email: 0, linkedin: 0, today: 0, overdue: 0 }
}
