import { and, asc, desc, eq, getTableColumns, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { createdByUserId, recordAudit, updatedByUserId } from '../../shared/lib/audit.js'
import {
  auditLog,
  calls,
  emailSends,
  emailSequenceEnrollments,
  emailSequences,
  prospectArchives,
  prospectCollaborators,
  prospectContactPoints,
  prospectNotes,
  prospectPeople,
  prospects,
  prospectScoringConfig,
  prospectStageEvents,
  prospectStatuses,
  prospectTasks,
  prospectTransferRequests,
  users,
} from '../../shared/db/schema/index.js'
import * as invoicingService from '../invoicing/service.js'
import { computeScore, type ScoringWeights } from './scoring.js'
import { compileProspectFilters, priorityCase, searchWhere, type FilterContext, type ProspectFilter } from './filters.js'
import type {
  CreateProspectSchema,
  CreateProspectStatusSchema,
  PromoteProspectSchema,
  UpdateProspectSchema,
  UpdateProspectStatusSchema,
  UpdateScoringConfigSchema,
} from './schema.js'
import { tr } from '../../shared/lib/i18n.js'
import { getCompany, getCompanyTimeZone } from '../../shared/lib/company.js'
import { getCountryPack } from '../../countries/index.js'
import { emitProspectEvent } from '../../shared/lib/prospect-events.js'
import type { SessionUser } from '../../shared/lib/session.js'
import {
  editableProspectsWhere,
  findVisibleProspect,
  ownerNameOf,
  requireEditableProspect,
  visibleProspectsWhere,
} from '../../shared/lib/prospect-access.js'

type CreateInput = z.infer<typeof CreateProspectSchema>
type UpdateInput = z.infer<typeof UpdateProspectSchema>
type PromoteInput = z.infer<typeof PromoteProspectSchema>
type ScoringConfigInput = z.infer<typeof UpdateScoringConfigSchema>
type CreateStatusInput = z.infer<typeof CreateProspectStatusSchema>
type UpdateStatusInput = z.infer<typeof UpdateProspectStatusSchema>

// ── Catalog statusuri prospect ───────────────────────────────────────────────

export class ProspectStatusKeyTakenError extends Error {}
export class ProspectStatusInUseError extends Error {
  constructor(public readonly count: number) {
    super(tr('errors.prospects.statusInUse', { count }))
  }
}
export class InvalidProspectStatusError extends Error {}
export class InvalidAssigneeError extends Error {}

export async function listProspectStatuses() {
  return db
    .select()
    .from(prospectStatuses)
    .where(isNull(prospectStatuses.deletedAt))
    .orderBy(asc(prospectStatuses.sortOrder))
}

export async function createProspectStatus(input: CreateStatusInput) {
  const [{ maxOrder } = { maxOrder: -1 }] = await db
    .select({ maxOrder: sql<number>`COALESCE(MAX(${prospectStatuses.sortOrder}), -1)` })
    .from(prospectStatuses)
    .where(isNull(prospectStatuses.deletedAt))

  const [row] = await db
    .insert(prospectStatuses)
    .values({ key: input.key, label: input.label, colorToken: input.colorToken, sortOrder: maxOrder + 1 })
    // Indexul unic pe `key` e PARȚIAL (WHERE deleted_at IS NULL — vezi schema) — `where` aici
    // trebuie să oglindească exact predicatul, altfel Postgres nu poate infera arbitrul de
    // conflict ("no unique or exclusion constraint matching") și insert-ul aruncă, nu face 409.
    .onConflictDoNothing({ target: [prospectStatuses.tenantId, prospectStatuses.key], where: isNull(prospectStatuses.deletedAt) })
    .returning()
  if (!row) throw new ProspectStatusKeyTakenError(tr('errors.prospects.statusExists', { key: input.key }))
  return row
}

export async function updateProspectStatus(id: string, input: UpdateStatusInput) {
  const [row] = await db
    .update(prospectStatuses)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(prospectStatuses.id, id), isNull(prospectStatuses.deletedAt)))
    .returning()
  return row
}

/** 409 dacă vreun prospect activ mai referențiază `key`-ul — Stefan reasignează întâi, fără ștergere în cascadă silențioasă. */
export async function deleteProspectStatus(id: string) {
  const [status] = await db.select().from(prospectStatuses).where(and(eq(prospectStatuses.id, id), isNull(prospectStatuses.deletedAt)))
  if (!status) return null

  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(prospects)
    .where(and(eq(prospects.status, status.key), isNull(prospects.deletedAt)))
  if (count > 0) throw new ProspectStatusInUseError(count)

  const [row] = await db.update(prospectStatuses).set({ deletedAt: new Date() }).where(eq(prospectStatuses.id, id)).returning()
  return row
}

export async function reorderProspectStatuses(orderedIds: string[]) {
  return db.transaction(async (tx) => {
    const existing = await tx.select({ id: prospectStatuses.id }).from(prospectStatuses).where(isNull(prospectStatuses.deletedAt))
    const existingIds = new Set(existing.map((r) => r.id))
    if (existingIds.size !== orderedIds.length || !orderedIds.every((id) => existingIds.has(id))) {
      throw new InvalidProspectStatusError(tr('errors.prospects.statusOrderMismatch'))
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.update(prospectStatuses).set({ sortOrder: i, updatedAt: new Date() }).where(eq(prospectStatuses.id, orderedIds[i]!))
    }
    return tx.select().from(prospectStatuses).where(isNull(prospectStatuses.deletedAt)).orderBy(asc(prospectStatuses.sortOrder))
  })
}

// ── Scoring config — un singur rând (pattern `dashboard_config`) ────────────

export async function getScoringConfig() {
  const [existing] = await db.select().from(prospectScoringConfig).orderBy(asc(prospectScoringConfig.createdAt)).limit(1)
  if (existing) return existing
  const [created] = await db.insert(prospectScoringConfig).values({}).returning()
  if (!created) throw new Error(tr('errors.prospects.scoringConfigFailed'))
  return created
}

export async function updateScoringConfig(input: ScoringConfigInput) {
  const config = await getScoringConfig()
  const [row] = await db
    .update(prospectScoringConfig)
    .set({
      budgetWeight: String(input.budgetWeight),
      needWeight: String(input.needWeight),
      techWeight: String(input.techWeight),
      contactWeight: String(input.contactWeight),
      hotThreshold: String(input.hotThreshold),
      warmThreshold: String(input.warmThreshold),
      nurtureThreshold: String(input.nurtureThreshold),
      updatedAt: new Date(),
    })
    .where(eq(prospectScoringConfig.id, config.id))
    .returning()
  return row
}

export function toScoringWeights(config: Awaited<ReturnType<typeof getScoringConfig>>): ScoringWeights {
  return {
    budgetWeight: Number(config.budgetWeight),
    needWeight: Number(config.needWeight),
    techWeight: Number(config.techWeight),
    contactWeight: Number(config.contactWeight),
  }
}

// ── Responsabil ──────────────────────────────────────────────────────────────

/** The colleagues a prospect can be assigned to: active people only. */
export async function listAssignees() {
  return db
    .select({ id: users.id, displayName: users.displayName, email: users.email })
    .from(users)
    .where(and(eq(users.status, 'active'), isNull(users.deletedAt)))
    .orderBy(sql`COALESCE(${users.displayName}, ${users.email})`)
}


function numericOrUndefined(v: number | null | undefined) {
  if (v === undefined) return undefined
  return v === null ? null : String(v)
}

// ── Prospects ────────────────────────────────────────────────────────────────

type Me = Pick<SessionUser, 'id' | 'features'> & { tenant?: SessionUser['tenant'] }

export class ProspectExistsError extends Error {
  readonly code = 'PROSPECT_EXISTS'
  constructor(public readonly existing: { id: string; name: string; ownerName: string | null }) {
    super('PROSPECT_EXISTS')
  }
}
export class LostReasonRequiredError extends Error {
  readonly code = 'LOST_REASON_REQUIRED'
}

export async function filterContext(me: Me, kind: 'companies' | 'people' = 'companies'): Promise<FilterContext> {
  const config = await getScoringConfig()
  return {
    me,
    kind,
    timeZone: me.tenant?.timeZone ?? (await getCompanyTimeZone()),
    thresholds: { hot: Number(config.hotThreshold), warm: Number(config.warmThreshold), nurture: Number(config.nurtureThreshold) },
  }
}

const SORTS = {
  score: sql`${prospects.score}`,
  name: sql`lower(${prospects.name})`,
  updatedAt: sql`${prospects.updatedAt}`,
  createdAt: sql`${prospects.createdAt}`,
  lastActivityAt: sql`${prospects.lastActivityAt}`,
  value: sql`${prospects.valueAmount}`,
  expectedCloseAt: sql`${prospects.expectedCloseAt}`,
  daysInStage: sql`${prospects.statusChangedAt}`,
  nextTask: sql`(SELECT min(t."due_at") FROM ${prospectTasks} t WHERE t."prospect_id" = ${prospects.id} AND t."done_at" IS NULL AND t."skipped_at" IS NULL AND t."deleted_at" IS NULL)`,
} as const
export type ProspectSort = keyof typeof SORTS
export const PROSPECT_SORTS = Object.keys(SORTS) as ProspectSort[]

function orderBy(sort: ProspectSort | undefined, dir: 'asc' | 'desc' | undefined): SQL {
  const key = sort ?? 'score'
  // "Days in stage" ascending = changed most recently, i.e. statusChangedAt descending.
  const asc = key === 'daysInStage' ? dir === 'desc' : (dir ?? (key === 'name' || key === 'nextTask' ? 'asc' : 'desc')) === 'asc'
  return sql`${SORTS[key]} ${sql.raw(asc ? 'ASC' : 'DESC')} NULLS LAST, ${prospects.id}`
}

/** The columns every prospect row carries: list, board cards, neighbors, the sheet. */
function rowColumns(ctx: FilterContext) {
  return {
    id: prospects.id,
    name: prospects.name,
    cif: prospects.cif,
    website: prospects.website,
    caenCode: prospects.caenCode,
    foundingYear: prospects.foundingYear,
    employeeCount: prospects.employeeCount,
    revenue: prospects.revenue,
    revenuePrev: prospects.revenuePrev,
    revenueYear: prospects.revenueYear,
    profit: prospects.profit,
    debt: prospects.debt,
    equity: prospects.equity,
    cash: prospects.cash,
    receivables: prospects.receivables,
    inventory: prospects.inventory,
    score: prospects.score,
    scoreBase: prospects.scoreBase,
    priority: priorityCase(ctx.thresholds),
    status: prospects.status,
    statusChangedAt: prospects.statusChangedAt,
    daysInStage: sql<number>`floor(extract(epoch FROM now() - ${prospects.statusChangedAt}) / 86400)::int`,
    lostReason: prospects.lostReason,
    source: prospects.source,
    platformId: prospects.platformId,
    billingClientId: prospects.billingClientId,
    valueAmount: prospects.valueAmount,
    valueCurrency: prospects.valueCurrency,
    expectedCloseAt: prospects.expectedCloseAt,
    isActive: prospects.isActive,
    assignedUserId: prospects.assignedUserId,
    claimedAt: prospects.claimedAt,
    ownerName: sql<string | null>`(SELECT coalesce(nullif(u."display_name", ''), u."email") FROM ${users} u WHERE u."id" = ${prospects.assignedUserId})`,
    lastActivityAt: prospects.lastActivityAt,
    lastContactedAt: prospects.lastContactedAt,
    createdAt: prospects.createdAt,
    updatedAt: prospects.updatedAt,
    archivedAt: sql<Date | null>`(SELECT a."archived_at" FROM ${prospectArchives} a WHERE a."prospect_id" = ${prospects.id} AND a."user_id" = ${ctx.me.id})`,
    canEdit: sql<boolean>`(${editableProspectsWhere(ctx.me)})`,
    primaryPhone: sql<string | null>`(SELECT cp."value" FROM ${prospectContactPoints} cp WHERE cp."prospect_id" = ${prospects.id} AND cp."kind" = 'phone' AND cp."deleted_at" IS NULL AND cp."status" <> 'invalid' ORDER BY cp."is_primary" DESC, cp."created_at" LIMIT 1)`,
    primaryEmail: sql<string | null>`(SELECT cp."value" FROM ${prospectContactPoints} cp WHERE cp."prospect_id" = ${prospects.id} AND cp."kind" = 'email' AND cp."deleted_at" IS NULL AND cp."status" = 'ok' ORDER BY cp."is_primary" DESC, cp."created_at" LIMIT 1)`,
    primaryPerson: sql<string | null>`(SELECT pp."name" FROM ${prospectPeople} pp WHERE pp."prospect_id" = ${prospects.id} AND pp."deleted_at" IS NULL ORDER BY pp."is_decision_maker" DESC, pp."position", pp."created_at" LIMIT 1)`,
    note: sql<{ id: string; body: string } | null>`(SELECT json_build_object('id', n."id", 'body', n."body") FROM ${prospectNotes} n WHERE n."prospect_id" = ${prospects.id} AND n."deleted_at" IS NULL ORDER BY n."pinned" DESC, n."created_at" DESC LIMIT 1)`,
    nextTask: sql<NextTask | null>`(SELECT json_build_object('id', t."id", 'kind', t."kind", 'title', t."title", 'dueAt', t."due_at", 'assigneeUserId', t."assignee_user_id",
        'assigneeName', (SELECT coalesce(nullif(u."display_name", ''), u."email") FROM ${users} u WHERE u."id" = t."assignee_user_id"))
      FROM ${prospectTasks} t WHERE t."prospect_id" = ${prospects.id} AND t."done_at" IS NULL AND t."skipped_at" IS NULL AND t."deleted_at" IS NULL
      ORDER BY t."due_at" LIMIT 1)`,
  }
}

export interface NextTask {
  id: string
  kind: string
  title: string
  dueAt: string
  assigneeUserId: string
  assigneeName: string | null
}

export interface ListInput {
  f: ProspectFilter[]
  q?: string
  kind?: 'companies' | 'people'
  sort?: ProspectSort
  dir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export async function prospectWhere(me: Me, input: Pick<ListInput, 'f' | 'q' | 'kind'>): Promise<SQL> {
  const ctx = await filterContext(me, input.kind)
  const where = compileProspectFilters(input.f, ctx)
  return input.q?.trim() ? sql`${where} AND ${searchWhere(input.q.trim())}` : where
}

export async function listProspects(me: Me, input: ListInput) {
  const page = Math.max(1, input.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 25))
  if (input.kind === 'people') return listPeople(me, input, page, pageSize)

  const ctx = await filterContext(me)
  const where = await prospectWhere(me, input)
  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    db
      .select(rowColumns(ctx))
      .from(prospects)
      .where(where)
      .orderBy(orderBy(input.sort, input.dir))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(prospects).where(where),
  ])
  return { rows, total, page, pageSize }
}

async function listPeople(me: Me, input: ListInput, page: number, pageSize: number) {
  const ctx = await filterContext(me, 'people')
  const where = and(await prospectWhere(me, { ...input, kind: 'people' }), isNull(prospectPeople.deletedAt))
  const base = db
    .select({
      id: prospectPeople.id,
      name: prospectPeople.name,
      role: prospectPeople.role,
      isDecisionMaker: prospectPeople.isDecisionMaker,
      doNotContact: prospectPeople.doNotContact,
      prospectId: prospects.id,
      prospectName: prospects.name,
      status: prospects.status,
      score: prospects.score,
      priority: priorityCase(ctx.thresholds),
      assignedUserId: prospects.assignedUserId,
      ownerName: sql<string | null>`(SELECT coalesce(nullif(u."display_name", ''), u."email") FROM ${users} u WHERE u."id" = ${prospects.assignedUserId})`,
      phone: sql<string | null>`(SELECT cp."value" FROM ${prospectContactPoints} cp WHERE cp."person_id" = ${prospectPeople.id} AND cp."kind" = 'phone' AND cp."deleted_at" IS NULL ORDER BY cp."is_primary" DESC LIMIT 1)`,
      email: sql<string | null>`(SELECT cp."value" FROM ${prospectContactPoints} cp WHERE cp."person_id" = ${prospectPeople.id} AND cp."kind" = 'email' AND cp."deleted_at" IS NULL ORDER BY cp."is_primary" DESC LIMIT 1)`,
      canEdit: sql<boolean>`(${editableProspectsWhere(me)})`,
    })
    .from(prospectPeople)
    .innerJoin(prospects, eq(prospects.id, prospectPeople.prospectId))
  const [rows, [{ total } = { total: 0 }]] = await Promise.all([
    base
      .where(where)
      .orderBy(sql`lower(${prospectPeople.name})`, prospectPeople.id)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(prospectPeople)
      .innerJoin(prospects, eq(prospects.id, prospectPeople.prospectId))
      .where(where),
  ])
  return { rows, total, page, pageSize }
}

export async function countProspects(me: Me, input: Pick<ListInput, 'f' | 'q' | 'kind'>) {
  const where = await prospectWhere(me, input)
  // The live count in "All filters" must not hang the page on a heavy filter.
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '2s'`)
    if (input.kind === 'people') {
      const [row] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(prospectPeople)
        .innerJoin(prospects, eq(prospects.id, prospectPeople.prospectId))
        .where(and(where, isNull(prospectPeople.deletedAt)))
      return row?.total ?? 0
    }
    const [row] = await tx.select({ total: sql<number>`count(*)::int` }).from(prospects).where(where)
    return row?.total ?? 0
  })
}

const AGGREGATE_FIELDS = {
  score: prospects.score,
  value: prospects.valueAmount,
  employees: prospects.employeeCount,
  revenue: prospects.revenue,
} as const
export type AggregateField = keyof typeof AGGREGATE_FIELDS
export type AggregateFn = 'count' | 'sum' | 'avg' | 'min' | 'max'

/** A column calculation over every filtered prospect, not the page. Value sums are per currency. */
export async function aggregateProspects(me: Me, input: Pick<ListInput, 'f' | 'q'>, field: AggregateField, fn: AggregateFn) {
  const where = await prospectWhere(me, input)
  const column = AGGREGATE_FIELDS[field]
  const expr = fn === 'count' ? sql`count(${column})` : sql`${sql.raw(fn)}(${column})`
  if (field === 'value' && fn !== 'count') {
    const rows = await db
      .select({ currency: prospects.valueCurrency, amount: sql<string | null>`${expr}::text` })
      .from(prospects)
      .where(and(where, isNotNull(prospects.valueAmount)))
      .groupBy(prospects.valueCurrency)
    return { value: null, byCurrency: rows.map((r) => ({ currency: r.currency, amount: r.amount === null ? null : Number(r.amount) })) }
  }
  const [row] = await db.select({ value: sql<string | null>`${expr}::text` }).from(prospects).where(where)
  return { value: row?.value === null || row?.value === undefined ? null : Number(row.value) }
}

export async function getProspectSheet(me: Me, id: string) {
  const ctx = await filterContext(me)
  let [row] = await db
    .select(rowColumns(ctx))
    .from(prospects)
    .where(and(eq(prospects.id, id), isNull(prospects.deletedAt), visibleProspectsWhere(me)))
  if (!row) {
    // An old link to a prospect merged into another opens the one it was merged into.
    const [merged] = await db.select({ into: prospects.mergedIntoId }).from(prospects).where(eq(prospects.id, id))
    if (!merged?.into) return undefined
    ;[row] = await db
      .select(rowColumns(ctx))
      .from(prospects)
      .where(and(eq(prospects.id, merged.into), isNull(prospects.deletedAt), visibleProspectsWhere(me)))
    if (!row) return undefined
  }
  const [people, contactPoints, collaborators, pendingTransfer] = await Promise.all([
    db
      .select()
      .from(prospectPeople)
      .where(and(eq(prospectPeople.prospectId, row.id), isNull(prospectPeople.deletedAt)))
      .orderBy(desc(prospectPeople.isDecisionMaker), prospectPeople.position, prospectPeople.createdAt),
    db
      .select()
      .from(prospectContactPoints)
      .where(and(eq(prospectContactPoints.prospectId, row.id), isNull(prospectContactPoints.deletedAt)))
      .orderBy(desc(prospectContactPoints.isPrimary), prospectContactPoints.createdAt),
    db
      .select({
        userId: prospectCollaborators.userId,
        level: prospectCollaborators.level,
        name: sql<string>`coalesce(nullif(${users.displayName}, ''), ${users.email})`,
      })
      .from(prospectCollaborators)
      .innerJoin(users, eq(users.id, prospectCollaborators.userId))
      .where(and(eq(prospectCollaborators.prospectId, row.id), isNull(prospectCollaborators.deletedAt))),
    db
      .select()
      .from(prospectTransferRequests)
      .where(and(eq(prospectTransferRequests.prospectId, row.id), eq(prospectTransferRequests.status, 'pending')))
      .orderBy(desc(prospectTransferRequests.createdAt)),
  ])
  return { ...row, people, contactPoints, collaborators, pendingRequests: pendingTransfer }
}

/** Previous / next prospect in the order of the list the sheet was opened from. */
export async function prospectNeighbors(me: Me, id: string, input: Omit<ListInput, 'page' | 'pageSize'>) {
  const where = await prospectWhere(me, input)
  const rows = await db.execute<{ prev_id: string | null; next_id: string | null; idx: number; total: number }>(sql`
    WITH ordered AS (
      SELECT ${prospects.id} AS id, row_number() OVER (ORDER BY ${orderBy(input.sort, input.dir)}) AS idx, count(*) OVER () AS total
        FROM ${prospects} WHERE ${where}
    ), me AS (SELECT idx, total FROM ordered WHERE id = ${id})
    SELECT (SELECT o.id FROM ordered o, me WHERE o.idx = me.idx - 1) AS prev_id,
           (SELECT o.id FROM ordered o, me WHERE o.idx = me.idx + 1) AS next_id,
           me.idx::int AS idx, me.total::int AS total
      FROM me`)
  const row = rows[0]
  return row ? { prevId: row.prev_id, nextId: row.next_id, index: row.idx, total: row.total } : null
}

export type TimelineKind = 'audit' | 'note' | 'task' | 'stage' | 'call' | 'email' | 'sequence'

/** Everything that happened to a prospect, newest first, cursor = ISO time of the last entry. */
export async function prospectTimeline(me: Me, id: string, cursor?: string, limit = 50) {
  const prospect = await findVisibleProspect(me, id)
  if (!prospect) return undefined
  const before = cursor ? sql`${cursor}::timestamptz` : sql`'infinity'::timestamptz`
  const name = (col: SQL) => sql`(SELECT coalesce(nullif(u."display_name", ''), u."email") FROM ${users} u WHERE u."id" = ${col})`
  const rows = await db.execute<{ id: string; kind: TimelineKind; at: string; author: string | null; data: Record<string, unknown> }>(sql`
    SELECT * FROM (
      SELECT a."id", 'audit' AS kind, a."created_at" AS at, ${name(sql`a."actor_user_id"`)} AS author,
             json_build_object('action', a."action", 'changes', a."changes") AS data
        FROM ${auditLog} a WHERE a."entity_type" = 'prospect' AND a."entity_id" = ${id}
      UNION ALL
      SELECT n."id", 'note', n."created_at", ${name(sql`n."author_user_id"`)}, json_build_object('body', n."body")
        FROM ${prospectNotes} n WHERE n."prospect_id" = ${id} AND n."deleted_at" IS NULL
      UNION ALL
      SELECT t."id", 'task', coalesce(t."done_at", t."created_at"), ${name(sql`coalesce(t."assignee_user_id", t."created_by_user_id")`)},
             json_build_object('kind', t."kind", 'title', t."title", 'dueAt', t."due_at", 'doneAt', t."done_at", 'outcome', t."outcome", 'outcomeNote', t."outcome_note")
        FROM ${prospectTasks} t WHERE t."prospect_id" = ${id} AND t."deleted_at" IS NULL
      UNION ALL
      SELECT e."id", 'stage', e."changed_at", ${name(sql`e."changed_by_user_id"`)}, json_build_object('from', e."from_status", 'to', e."to_status")
        FROM ${prospectStageEvents} e WHERE e."prospect_id" = ${id} AND e."deleted_at" IS NULL AND e."from_status" IS NOT NULL
      UNION ALL
      SELECT c."id", 'call', coalesce(c."scheduled_at", c."created_at"), ${name(sql`c."created_by_user_id"`)},
             json_build_object('title', c."title", 'status', c."status", 'durationSeconds', c."duration_seconds")
        FROM ${calls} c WHERE c."prospect_id" = ${id} AND c."deleted_at" IS NULL
      UNION ALL
      SELECT s."id", 'email', s."created_at", ${name(sql`s."sent_by_user_id"`)},
             json_build_object('subject', s."subject", 'recipient', s."recipient", 'status', s."status", 'openedAt', s."opened_at", 'kind', s."kind")
        FROM ${emailSends} s
       WHERE s."deleted_at" IS NULL AND s."status" NOT IN ('scheduled', 'cancelled')
         AND lower(s."recipient") IN (SELECT cp."value_normalized" FROM ${prospectContactPoints} cp WHERE cp."prospect_id" = ${id} AND cp."kind" = 'email')
      UNION ALL
      SELECT en."id", 'sequence', en."enrolled_at", NULL,
             json_build_object('sequence', (SELECT sq."name" FROM ${emailSequences} sq WHERE sq."id" = en."sequence_id"), 'status', en."status", 'step', en."current_step")
        FROM ${emailSequenceEnrollments} en WHERE en."prospect_id" = ${id} AND en."deleted_at" IS NULL
    ) entries
    WHERE at < ${before}
    ORDER BY at DESC
    LIMIT ${limit}`)
  const entries = [...rows]
  return { entries, nextCursor: entries.length === limit ? String(entries.at(-1)?.at) : null }
}

// ── Score ────────────────────────────────────────────────────────────────────

async function contactFlags(prospectId: string) {
  const [row] = await db
    .select({
      hasPhone: sql<boolean>`bool_or(${prospectContactPoints.kind} = 'phone')`,
      hasEmail: sql<boolean>`bool_or(${prospectContactPoints.kind} = 'email')`,
      hasPerson: sql<boolean>`EXISTS (SELECT 1 FROM ${prospectPeople} pp WHERE pp."prospect_id" = ${prospectId} AND pp."deleted_at" IS NULL)`,
    })
    .from(prospectContactPoints)
    .where(and(eq(prospectContactPoints.prospectId, prospectId), isNull(prospectContactPoints.deletedAt)))
  return { hasPhone: Boolean(row?.hasPhone), hasEmail: Boolean(row?.hasEmail), hasContactName: Boolean(row?.hasPerson) }
}

type FinancialRow = Pick<
  typeof prospects.$inferSelect,
  'revenue' | 'profit' | 'debt' | 'equity' | 'cash' | 'receivables' | 'inventory' | 'employeeCount' | 'foundingYear' | 'website' | 'isActive'
>

export function baseScore(p: FinancialRow, flags: { hasPhone: boolean; hasEmail: boolean; hasContactName: boolean }, weights: ScoringWeights) {
  const num = (v: string | null) => (v === null ? null : Number(v))
  const revenue = num(p.revenue)
  const hasAnyFinancialData = Boolean((revenue && revenue > 500) || (p.employeeCount && p.employeeCount > 0))
  return computeScore(
    {
      revenue,
      profit: num(p.profit),
      debt: num(p.debt),
      equity: num(p.equity),
      cash: num(p.cash),
      receivables: num(p.receivables),
      inventory: num(p.inventory),
      employeeCount: p.employeeCount,
      foundingYear: p.foundingYear,
      hasWebsite: Boolean(p.website),
      ...flags,
      hasRecentFinancials: hasAnyFinancialData,
      hasAnyFinancialData,
      isActive: p.isActive ?? undefined,
    },
    weights,
  )
}

/** Recomputes one prospect's score after its data or contacts changed. */
export async function refreshScore(prospectId: string) {
  const [p] = await db.select().from(prospects).where(eq(prospects.id, prospectId))
  if (!p) return
  const weights = toScoringWeights(await getScoringConfig())
  const base = baseScore(p, await contactFlags(prospectId), weights)
  await db.update(prospects).set({ scoreBase: String(base), score: String(base) }).where(eq(prospects.id, prospectId))
  await scoreHooks.afterBase(prospectId)
}

/** Filled by the score module (criteria and signals) so this file stays the base score only. */
export const scoreHooks: { afterBase: (prospectId: string) => Promise<void>; afterAll: () => Promise<void> } = {
  afterBase: async () => {},
  afterAll: async () => {},
}

// ── Create / update / delete ─────────────────────────────────────────────────

async function countryPack() {
  const company = await getCompany()
  return getCountryPack(company.country)
}

export function normalizeEmail(raw: string) {
  return raw.trim().toLowerCase()
}

export async function findByCif(cif: string) {
  const [existing] = await db
    .select({ id: prospects.id, name: prospects.name, assignedUserId: prospects.assignedUserId })
    .from(prospects)
    .where(and(isNull(prospects.deletedAt), sql`${prospects.cifNormalized} = upper(regexp_replace(${cif}, '^[[:space:]]*RO|[[:space:]]', '', 'gi'))`))
    .limit(1)
  return existing
}

export async function createProspect(me: Me, input: CreateInput) {
  if (input.cif?.trim()) {
    const existing = await findByCif(input.cif)
    if (existing) throw new ProspectExistsError({ id: existing.id, name: existing.name, ownerName: await ownerNameOf(existing.assignedUserId) })
  }
  const pack = await countryPack()
  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(prospects)
      .values({
        ...createdByUserId(),
        ...updatedByUserId(),
        name: input.name,
        cif: input.cif?.trim() || null,
        website: input.website,
        caenCode: input.caenCode,
        foundingYear: input.foundingYear,
        employeeCount: input.employeeCount,
        revenue: numericOrUndefined(input.revenue),
        profit: numericOrUndefined(input.profit),
        debt: numericOrUndefined(input.debt),
        equity: numericOrUndefined(input.equity),
        cash: numericOrUndefined(input.cash),
        receivables: numericOrUndefined(input.receivables),
        inventory: numericOrUndefined(input.inventory),
        isActive: input.isActive,
        source: input.source,
        platformId: input.platformId,
        assignedUserId: me.id,
        claimedAt: new Date(),
        lastActivityAt: new Date(),
      })
      .returning()
    if (!created) throw new Error('prospect insert returned nothing')
    let personId: string | null = null
    if (input.contactName?.trim()) {
      const [person] = await tx.insert(prospectPeople).values({ prospectId: created.id, name: input.contactName.trim() }).returning()
      personId = person?.id ?? null
    }
    const points = [
      ...(input.phone ? [{ kind: 'phone' as const, value: input.phone.trim(), valueNormalized: pack.normalizePhone(input.phone) }] : []),
      ...(input.email ? [{ kind: 'email' as const, value: input.email.trim(), valueNormalized: normalizeEmail(input.email) }] : []),
    ]
    if (points.length) await tx.insert(prospectContactPoints).values(points.map((p) => ({ ...p, prospectId: created.id, personId, isPrimary: true })))
    await tx.insert(prospectStageEvents).values({ prospectId: created.id, fromStatus: null, toStatus: created.status, changedByUserId: me.id, changedAt: new Date() })
    return created
  })
  await refreshScore(row.id)
  await recordAudit({ action: 'prospect.creat', entityType: 'prospect', entityId: row.id, changes: { name: [null, row.name] } })
  emitProspectEvent('prospect.created', { prospectId: row.id, via: 'manual' })
  return row
}

const AUDITED_FIELDS = [
  'name',
  'cif',
  'website',
  'caenCode',
  'foundingYear',
  'employeeCount',
  'status',
  'lostReason',
  'source',
  'valueAmount',
  'valueCurrency',
  'expectedCloseAt',
  'isActive',
  'revenue',
  'profit',
  'debt',
  'equity',
  'cash',
  'receivables',
  'inventory',
] as const

export async function statusKind(key: string): Promise<'open' | 'won' | 'lost' | null> {
  const [row] = await db
    .select({ kind: prospectStatuses.kind })
    .from(prospectStatuses)
    .where(and(eq(prospectStatuses.key, key), isNull(prospectStatuses.deletedAt)))
  return row?.kind ?? null
}

/** Status change with its stage event and event; used by PATCH, bulk, board and automations. */
export async function changeStatus(
  executor: Pick<typeof db, 'insert' | 'update'>,
  prospect: { id: string; status: string },
  to: string,
  kind: 'open' | 'won' | 'lost',
  actorUserId: string | null,
  lostReason?: string | null,
) {
  const now = new Date()
  await executor
    .update(prospects)
    .set({ status: to, statusChangedAt: now, lostReason: kind === 'lost' ? (lostReason ?? null) : null, updatedAt: now })
    .where(eq(prospects.id, prospect.id))
  await executor.insert(prospectStageEvents).values({ prospectId: prospect.id, fromStatus: prospect.status, toStatus: to, changedByUserId: actorUserId, changedAt: now })
  emitProspectEvent('prospect.stage_changed', { prospectId: prospect.id, from: prospect.status, to, kind })
}

export async function updateProspect(me: Me, id: string, input: UpdateInput) {
  const existing = await requireEditableProspect(me, id)
  if (!existing) return null

  let kind: 'open' | 'won' | 'lost' | null = null
  if (input.status !== undefined && input.status !== existing.status) {
    kind = await statusKind(input.status)
    if (!kind) throw new InvalidProspectStatusError(tr('errors.prospects.statusNotInCatalog', { status: input.status }))
    if (kind === 'lost' && !input.lostReason?.trim()) throw new LostReasonRequiredError(tr('errors.prospects.lostReasonRequired'))
  }

  const { status, lostReason, revenue, profit, debt, equity, cash, receivables, inventory, valueAmount, expectedCloseAt, ...rest } = input
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(prospects)
      .set({
        ...rest,
        ...updatedByUserId(),
        revenue: numericOrUndefined(revenue),
        profit: numericOrUndefined(profit),
        debt: numericOrUndefined(debt),
        equity: numericOrUndefined(equity),
        cash: numericOrUndefined(cash),
        receivables: numericOrUndefined(receivables),
        inventory: numericOrUndefined(inventory),
        valueAmount: numericOrUndefined(valueAmount),
        expectedCloseAt: expectedCloseAt === undefined ? undefined : expectedCloseAt,
        lostReason: kind === null && lostReason !== undefined ? lostReason : undefined,
        updatedAt: new Date(),
      })
      .where(eq(prospects.id, id))
      .returning()
    if (kind && status) await changeStatus(tx, existing, status, kind, me.id, lostReason)
    return updated
  })

  const after = { ...existing, ...row, status: status ?? existing.status, lostReason: kind === 'lost' ? (lostReason ?? null) : (row?.lostReason ?? null) }
  const changes: Record<string, [unknown, unknown]> = {}
  for (const field of AUDITED_FIELDS) {
    const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v)
    const before = iso(existing[field])
    const now = iso(after[field])
    if (String(before ?? '') !== String(now ?? '')) changes[field] = [before ?? null, now ?? null]
  }
  if (Object.keys(changes).length) await recordAudit({ action: 'prospect.modificat', entityType: 'prospect', entityId: id, changes })
  await refreshScore(id)
  return getProspectSheet(me, id)
}

export async function deleteProspect(me: Me, id: string) {
  const existing = await requireEditableProspect(me, id)
  if (!existing) return undefined
  const [row] = await db.update(prospects).set({ deletedAt: new Date() }).where(eq(prospects.id, id)).returning()
  await recordAudit({ action: 'prospect.sters', entityType: 'prospect', entityId: id, changes: { name: [existing.name, null] } })
  return row
}

// ── Archive (per person) ─────────────────────────────────────────────────────

async function visibleIds(me: Me, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({ id: prospects.id })
    .from(prospects)
    .where(and(inArray(prospects.id, ids), isNull(prospects.deletedAt), visibleProspectsWhere(me)))
  return rows.map((r) => r.id)
}

export async function archiveProspects(me: Me, ids: string[]) {
  const live = await visibleIds(me, ids)
  if (live.length === 0) return []
  await db
    .insert(prospectArchives)
    .values(live.map((prospectId) => ({ prospectId, userId: me.id })))
    .onConflictDoNothing()
  return live
}

export async function unarchiveProspects(me: Me, ids: string[]) {
  const live = await visibleIds(me, ids)
  if (live.length === 0) return []
  await db.delete(prospectArchives).where(and(eq(prospectArchives.userId, me.id), inArray(prospectArchives.prospectId, live)))
  return live
}

// ── Bulk ─────────────────────────────────────────────────────────────────────

export interface BulkInput {
  ids?: string[]
  f?: ProspectFilter[]
  q?: string
  all?: boolean
  action: 'status' | 'archive' | 'unarchive'
  value?: string
  lostReason?: string
}

/** Ids picked or "all N matching"; capped so a bulk action stays one bounded request. */
export async function resolveTargetIds(me: Me, input: Pick<BulkInput, 'ids' | 'f' | 'q' | 'all'>, cap = 5000): Promise<string[]> {
  if (input.all) {
    const where = await prospectWhere(me, { f: input.f ?? [], q: input.q })
    const rows = await db.select({ id: prospects.id }).from(prospects).where(where).limit(cap)
    return rows.map((r) => r.id)
  }
  return visibleIds(me, (input.ids ?? []).slice(0, cap))
}

export async function bulkUpdate(me: Me, input: BulkInput) {
  const ids = await resolveTargetIds(me, input)
  if (input.action === 'archive') return { updated: (await archiveProspects(me, ids)).length, skipped: [] }
  if (input.action === 'unarchive') return { updated: (await unarchiveProspects(me, ids)).length, skipped: [] }

  const to = input.value ?? ''
  const kind = await statusKind(to)
  if (!kind) throw new InvalidProspectStatusError(tr('errors.prospects.statusNotInCatalog', { status: to }))
  if (kind === 'lost' && !input.lostReason?.trim()) throw new LostReasonRequiredError(tr('errors.prospects.lostReasonRequired'))

  const editable = new Set(
    (
      await db
        .select({ id: prospects.id })
        .from(prospects)
        .where(and(inArray(prospects.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']), editableProspectsWhere(me)))
    ).map((r) => r.id),
  )
  const skipped = ids.filter((id) => !editable.has(id)).map((id) => ({ id, reason: 'PROSPECT_NOT_YOURS' }))
  const rows = editable.size
    ? await db
        .select({ id: prospects.id, status: prospects.status })
        .from(prospects)
        .where(and(inArray(prospects.id, [...editable]), sql`${prospects.status} <> ${to}`))
    : []
  for (const p of rows) {
    await db.transaction((tx) => changeStatus(tx, p, to, kind, me.id, input.lostReason))
    await recordAudit({ action: 'prospect.modificat', entityType: 'prospect', entityId: p.id, changes: { status: [p.status, to] } })
  }
  return { updated: rows.length, skipped }
}

// ── Promote to client ────────────────────────────────────────────────────────

/** Creates the billing client and links it, in one transaction, audited. */
export async function promoteProspect(me: Me, id: string, input: PromoteInput) {
  const prospect = await requireEditableProspect(me, id)
  if (!prospect) return null
  const cif = input.cif ?? prospect.cif
  if (!cif) throw new Error(tr('errors.prospects.cifMissing'))
  const [email] = await db
    .select({ value: prospectContactPoints.value })
    .from(prospectContactPoints)
    .where(and(eq(prospectContactPoints.prospectId, id), eq(prospectContactPoints.kind, 'email'), eq(prospectContactPoints.status, 'ok'), isNull(prospectContactPoints.deletedAt)))
    .orderBy(desc(prospectContactPoints.isPrimary))
    .limit(1)
  const company = await getCompany()

  const row = await db.transaction(async (tx) => {
    const client = await invoicingService.createClient(
      {
        name: prospect.name,
        cif,
        address: input.address,
        city: input.city,
        county: input.county,
        email: email?.value,
        platformId: input.platformId ?? prospect.platformId ?? undefined,
        country: company.country,
      },
      tx,
    )
    if (!client) throw new Error(tr('errors.prospects.clientNotCreated'))
    const [won] = await tx
      .select({ key: prospectStatuses.key })
      .from(prospectStatuses)
      .where(and(eq(prospectStatuses.kind, 'won'), isNull(prospectStatuses.deletedAt)))
      .orderBy(asc(prospectStatuses.sortOrder))
      .limit(1)
    await tx.update(prospects).set({ billingClientId: client.id, updatedAt: new Date() }).where(eq(prospects.id, id))
    if (won && won.key !== prospect.status) await changeStatus(tx, prospect, won.key, 'won', me.id)
    return { ...prospect, billingClientId: client.id }
  })
  await recordAudit({ action: 'prospect.promovat', entityType: 'prospect', entityId: id, changes: { billingClientId: [null, row.billingClientId] } })
  return row
}

// ── Email hooks (called by the email module through shared code paths) ───────

/** Unsubscribe: the address's contact points become `unsubscribed`. Exact match, no LIKE. */
export async function markProspectUnsubscribedByEmail(email: string) {
  const rows = await db
    .update(prospectContactPoints)
    .set({ status: 'unsubscribed', updatedAt: new Date() })
    .where(and(eq(prospectContactPoints.kind, 'email'), eq(prospectContactPoints.valueNormalized, normalizeEmail(email)), isNull(prospectContactPoints.deletedAt)))
    .returning({ prospectId: prospectContactPoints.prospectId })
  return rows[0] ?? null
}

/** Recomputes every base score with the current config, in SQL batches of 1,000. */
export async function recalculateAllScores() {
  const weights = toScoringWeights(await getScoringConfig())
  let done = 0
  let after = '00000000-0000-0000-0000-000000000000'
  for (;;) {
    const batch = await db
      .select({
        ...getTableColumns(prospects),
        hasPhone: sql<boolean>`EXISTS (SELECT 1 FROM ${prospectContactPoints} cp WHERE cp."prospect_id" = ${prospects.id} AND cp."kind" = 'phone' AND cp."deleted_at" IS NULL)`,
        hasEmail: sql<boolean>`EXISTS (SELECT 1 FROM ${prospectContactPoints} cp WHERE cp."prospect_id" = ${prospects.id} AND cp."kind" = 'email' AND cp."deleted_at" IS NULL)`,
        hasContactName: sql<boolean>`EXISTS (SELECT 1 FROM ${prospectPeople} pp WHERE pp."prospect_id" = ${prospects.id} AND pp."deleted_at" IS NULL)`,
      })
      .from(prospects)
      .where(and(isNull(prospects.deletedAt), sql`${prospects.id} > ${after}`))
      .orderBy(prospects.id)
      .limit(1000)
    if (batch.length === 0) break
    const values = batch.map((p) => sql`(${p.id}::uuid, ${String(baseScore(p, p, weights))}::numeric)`)
    await db.execute(sql`
      UPDATE ${prospects} SET "score_base" = v.score, "score" = v.score
        FROM (VALUES ${sql.join(values, sql`, `)}) AS v(id, score)
       WHERE ${prospects.id} = v.id`)
    done += batch.length
    after = batch.at(-1)!.id
  }
  await scoreHooks.afterAll()
  return done
}
