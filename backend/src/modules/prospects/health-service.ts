import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { auditLog, dashboardConfig, prospectContactPoints, prospects } from '../../shared/db/schema/index.js'
import { currentActor } from '../../shared/lib/request-context.js'
import { currentTenantId } from '../../shared/lib/tenancy.js'
import {
  editableProspectsWhere,
  findVisibleProspect,
  foldDiacritics,
  PROSPECT_ID,
  requireEditableProspect,
  visibleProspectsWhere,
} from '../../shared/lib/prospect-access.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { MERGE_FIELDS, type MergeField } from './health-schema.js'
import { hasOkContactPoint } from './filters.js'
import { changeStatus, getProspectSheet, refreshScore, statusKind } from './service.js'

type Me = Pick<SessionUser, 'id' | 'features'> & { tenant?: SessionUser['tenant'] }

export class MergeSameError extends Error {
  readonly code = 'MERGE_SAME'
}
export class MergeAlreadyMergedError extends Error {
  readonly code = 'MERGE_ALREADY_MERGED'
}

// ── Duplicate pairs (computed by the hourly job, kept in dashboard_config) ───

const DUPLICATES_KEY = 'clienti.duplicates'
const MAX_PAIRS = 2000
// Each rule is capped on its own so a shared switchboard number cannot fill the temp files.
const MAX_PAIRS_PER_RULE = 4000

export type DuplicateReason = 'cif' | 'phone' | 'email' | 'name'
export interface DuplicatePair {
  a: string
  b: string
  reasons: DuplicateReason[]
}
export interface DuplicatesState {
  checkedAt: string | null
  pairs: DuplicatePair[]
}

export async function getDuplicatesState(): Promise<DuplicatesState> {
  const [row] = await db.select().from(dashboardConfig).where(and(eq(dashboardConfig.key, DUPLICATES_KEY), isNull(dashboardConfig.deletedAt)))
  if (!row) return { checkedAt: null, pairs: [] }
  return row.value as DuplicatesState
}

async function setDuplicatesState(value: DuplicatesState) {
  await db
    .insert(dashboardConfig)
    .values({ key: DUPLICATES_KEY, value })
    .onConflictDoUpdate({ target: [dashboardConfig.tenantId, dashboardConfig.key], set: { value: sql`excluded.value`, updatedAt: new Date() } })
}

/** Lowercase, no diacritics, no legal-form suffix (SRL, SA, PFA, II) and no punctuation or spaces.
 *  Dots go first so "S.R.L." collapses to "srl" before the whole-word strip; "casa" keeps its "sa". */
const normalizedName = (col: SQL) =>
  sql`regexp_replace(regexp_replace(regexp_replace(${foldDiacritics(sql`replace(${col}, '.', '')`)}, '[^a-z0-9]+', ' ', 'g'), '\\y(srl|sa|pfa|ii)\\y', ' ', 'g'), '\\s+', '', 'g')`

type PairRow = { a: string; b: string; reasons: DuplicateReason[] }

/** Whole-tenant recompute, in SQL (self-joins), never pairwise in JS. */
export async function recomputeDuplicates(): Promise<DuplicatesState> {
  const tenantId = currentTenantId()
  const rows = await db.execute<PairRow>(sql`
    WITH live AS (
      SELECT p.id, p.cif_normalized AS cif, ${normalizedName(sql`p."name"`)} AS nm
        FROM prospects p
       WHERE p.tenant_id = ${tenantId}::uuid AND p.deleted_at IS NULL AND p.merged_into_id IS NULL
    ), found AS (
      (SELECT DISTINCT x.id AS a, y.id AS b, 'cif' AS reason
         FROM live x JOIN live y ON y.cif = x.cif AND x.id < y.id
        WHERE x.cif <> '' LIMIT ${MAX_PAIRS_PER_RULE})
      UNION ALL
      (SELECT DISTINCT x.prospect_id AS a, y.prospect_id AS b, x.kind AS reason
         FROM prospect_contact_points x
         JOIN prospect_contact_points y ON y.tenant_id = x.tenant_id AND y.kind = x.kind AND y.value_normalized = x.value_normalized AND x.prospect_id < y.prospect_id
         JOIN live lx ON lx.id = x.prospect_id
         JOIN live ly ON ly.id = y.prospect_id
        WHERE x.tenant_id = ${tenantId}::uuid AND x.deleted_at IS NULL AND y.deleted_at IS NULL AND x.value_normalized <> '' LIMIT ${MAX_PAIRS_PER_RULE})
      UNION ALL
      (SELECT DISTINCT x.id AS a, y.id AS b, 'name' AS reason
         FROM live x JOIN live y ON y.nm = x.nm AND x.id < y.id
        WHERE x.nm <> '' LIMIT ${MAX_PAIRS_PER_RULE})
    )
    SELECT a, b, array_agg(DISTINCT reason ORDER BY reason) AS reasons
      FROM found GROUP BY a, b
     ORDER BY min(CASE reason WHEN 'cif' THEN 0 WHEN 'name' THEN 2 ELSE 1 END), a, b
     LIMIT ${MAX_PAIRS}`)
  const state: DuplicatesState = { checkedAt: new Date().toISOString(), pairs: rows.map((r) => ({ a: r.a, b: r.b, reasons: r.reasons })) }
  await setDuplicatesState(state)
  return state
}

/** After a merge: drop the pairs of the merged prospect without recomputing everything. */
async function dropPairsOf(prospectId: string) {
  const state = await getDuplicatesState()
  if (!state.pairs.some((p) => p.a === prospectId || p.b === prospectId)) return
  await setDuplicatesState({ ...state, pairs: state.pairs.filter((p) => p.a !== prospectId && p.b !== prospectId) })
}

/** The stored pairs where both sides are live and visible to this person. */
async function visiblePairs(me: Me) {
  const state = await getDuplicatesState()
  const ids = [...new Set(state.pairs.flatMap((p) => [p.a, p.b]))]
  if (ids.length === 0) return { checkedAt: state.checkedAt, pairs: [] as DuplicatePair[] }
  const rows = await db
    .select({ id: prospects.id })
    .from(prospects)
    .where(and(inArray(prospects.id, ids), isNull(prospects.deletedAt), visibleProspectsWhere(me)))
  const visible = new Set(rows.map((r) => r.id))
  return { checkedAt: state.checkedAt, pairs: state.pairs.filter((p) => visible.has(p.a) && visible.has(p.b)) }
}

// ── Counts ───────────────────────────────────────────────────────────────────

export async function getHealth(me: Me) {
  const [counts] = await db
    .select({
      withoutPhone: sql<number>`(count(*) FILTER (WHERE NOT ${hasOkContactPoint('phone')}))::int`,
      withoutEmail: sql<number>`(count(*) FILTER (WHERE NOT ${hasOkContactPoint('email')}))::int`,
      invalidOrBounced: sql<number>`(count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ${prospectContactPoints} cp WHERE cp."prospect_id" = ${PROSPECT_ID} AND cp."deleted_at" IS NULL AND cp."status" IN ('invalid', 'bounced'))))::int`,
      struckOff: sql<number>`(count(*) FILTER (WHERE ${prospects.isActive} = false))::int`,
    })
    .from(prospects)
    .where(
      and(
        isNull(prospects.deletedAt),
        visibleProspectsWhere(me),
        sql`NOT EXISTS (SELECT 1 FROM prospect_archives a WHERE a."prospect_id" = ${PROSPECT_ID} AND a."user_id" = ${me.id})`,
      ),
    )
  const { checkedAt, pairs } = await visiblePairs(me)
  return {
    withoutPhone: counts?.withoutPhone ?? 0,
    withoutEmail: counts?.withoutEmail ?? 0,
    invalidOrBounced: counts?.invalidOrBounced ?? 0,
    struckOff: counts?.struckOff ?? 0,
    duplicates: pairs.length,
    lastCheckedAt: checkedAt,
  }
}

// ── Duplicates list ──────────────────────────────────────────────────────────

interface PartRow {
  id: string
  name: string
  cif: string | null
  ownerName: string | null
  status: string
  createdAt: Date
  people: number
  contactPoints: number
  notes: number
  openTasks: number
  canEdit: boolean
}

async function partsOf(me: Me, ids: string[]): Promise<Map<string, PartRow>> {
  const rows = await db
    .select({
      id: prospects.id,
      name: prospects.name,
      cif: prospects.cif,
      ownerName: sql<string | null>`(SELECT coalesce(nullif(u."display_name", ''), u."email") FROM users u WHERE u."id" = ${prospects.assignedUserId})`,
      status: prospects.status,
      createdAt: prospects.createdAt,
      people: sql<number>`(SELECT count(*) FROM prospect_people x WHERE x."prospect_id" = ${PROSPECT_ID} AND x."deleted_at" IS NULL)::int`,
      contactPoints: sql<number>`(SELECT count(*) FROM prospect_contact_points x WHERE x."prospect_id" = ${PROSPECT_ID} AND x."deleted_at" IS NULL)::int`,
      notes: sql<number>`(SELECT count(*) FROM prospect_notes x WHERE x."prospect_id" = ${PROSPECT_ID} AND x."deleted_at" IS NULL)::int`,
      openTasks: sql<number>`(SELECT count(*) FROM prospect_tasks x WHERE x."prospect_id" = ${PROSPECT_ID} AND x."deleted_at" IS NULL AND x."done_at" IS NULL AND x."skipped_at" IS NULL)::int`,
      canEdit: sql<boolean>`(${editableProspectsWhere(me)})`,
    })
    .from(prospects)
    .where(inArray(prospects.id, ids))
  return new Map(rows.map((r) => [r.id, r]))
}

export async function listDuplicates(me: Me, page = 1, pageSize = 20) {
  const { checkedAt, pairs } = await visiblePairs(me)
  const slice = pairs.slice((page - 1) * pageSize, page * pageSize)
  const parts = await partsOf(me, [...new Set(slice.flatMap((p) => [p.a, p.b]))])
  const items = slice.flatMap((pair) => {
    const a = parts.get(pair.a)
    const b = parts.get(pair.b)
    if (!a || !b) return []
    const { canEdit: aEdit, ...left } = a
    const { canEdit: bEdit, ...right } = b
    return [{ a: left, b: right, reasons: pair.reasons, canMerge: aEdit && bEdit }]
  })
  return { items, total: pairs.length, page, pageSize, checkedAt }
}

// ── Merge ────────────────────────────────────────────────────────────────────

type ProspectRow = typeof prospects.$inferSelect

const isEmpty = (v: unknown) => v === null || v === undefined || v === ''
const sameValue = (a: unknown, b: unknown) => (isEmpty(a) && isEmpty(b)) || String(a ?? '') === String(b ?? '')

/** Choosing `revenue` takes the turnover with its year and the previous year; the owner comes with the claim date. */
const COPIED_WITH: Partial<Record<MergeField, (keyof ProspectRow)[]>> = {
  revenue: ['revenue', 'revenuePrev', 'revenueYear'],
  assignedUserId: ['assignedUserId', 'claimedAt'],
}
const columnsOf = (field: MergeField) => COPIED_WITH[field] ?? [field as keyof ProspectRow]
const differs = (field: MergeField, a: ProspectRow, b: ProspectRow) =>
  (field === 'revenue' ? columnsOf(field) : [field as keyof ProspectRow]).some((c) => !sameValue(a[c], b[c]))

async function loadPair(me: Me, masterId: string, otherId: string, edit: boolean) {
  if (masterId === otherId) throw new MergeSameError()
  const load = edit ? (id: string) => requireEditableProspect(me, id) : (id: string) => findVisibleProspect(me, id)
  const master = await load(masterId)
  const other = await load(otherId)
  if (master && other) return { master, other }
  // A deleted row is invisible, so a prospect that was already merged would answer 404 without this.
  const [merged] = await db
    .select({ id: prospects.id })
    .from(prospects)
    .where(and(inArray(prospects.id, [masterId, otherId]), sql`${prospects.mergedIntoId} IS NOT NULL`))
  if (merged) throw new MergeAlreadyMergedError()
  return undefined
}

export async function previewMerge(me: Me, masterId: string, otherId: string) {
  const pair = await loadPair(me, masterId, otherId, false)
  if (!pair) return undefined
  const { master, other } = pair
  const otherNewer = other.updatedAt > master.updatedAt
  const fields = MERGE_FIELDS.flatMap((field) => {
    if (!differs(field, master, other)) return []
    const filled = (p: ProspectRow) => !isEmpty(p[field as keyof ProspectRow])
    const proposed: 'master' | 'other' = !filled(master) && filled(other) ? 'other' : !filled(other) ? 'master' : otherNewer ? 'other' : 'master'
    return [{ field, master: master[field as keyof ProspectRow] ?? null, other: other[field as keyof ProspectRow] ?? null, proposed }]
  })

  const o = sql`${otherId}::uuid`
  const [moves] = await db.execute<{
    people: number
    contactPoints: number
    notes: number
    voiceNotes: number
    tasks: number
    listMemberships: number
    enrollments: number
    stageEvents: number
    collaborators: number
    calls: number
  }>(sql`
    SELECT (SELECT count(*) FROM prospect_people WHERE prospect_id = ${o} AND deleted_at IS NULL)::int AS "people",
           (SELECT count(*) FROM prospect_contact_points WHERE prospect_id = ${o} AND deleted_at IS NULL)::int AS "contactPoints",
           (SELECT count(*) FROM prospect_notes WHERE prospect_id = ${o} AND deleted_at IS NULL)::int AS "notes",
           (SELECT count(*) FROM prospect_voice_notes WHERE prospect_id = ${o} AND deleted_at IS NULL)::int AS "voiceNotes",
           (SELECT count(*) FROM prospect_tasks WHERE prospect_id = ${o} AND deleted_at IS NULL)::int AS "tasks",
           (SELECT count(*) FROM prospect_list_members WHERE prospect_id = ${o})::int AS "listMemberships",
           (SELECT count(*) FROM email_sequence_enrollments WHERE prospect_id = ${o} AND deleted_at IS NULL)::int AS "enrollments",
           (SELECT count(*) FROM prospect_stage_events WHERE prospect_id = ${o})::int AS "stageEvents",
           (SELECT count(*) FROM prospect_collaborators WHERE prospect_id = ${o} AND deleted_at IS NULL)::int AS "collaborators",
           (SELECT count(*) FROM calls WHERE prospect_id = ${o})::int AS "calls"`)
  return { fields, moves: moves! }
}

export async function mergeProspects(me: Me, masterId: string, otherId: string, choices: Partial<Record<MergeField, 'master' | 'other'>>) {
  const pair = await loadPair(me, masterId, otherId, true)
  if (!pair) return undefined
  const { master, other } = pair

  const chosen = MERGE_FIELDS.filter((f) => choices[f] === 'other')
  const copied: Record<string, unknown> = {}
  for (const field of chosen) if (field !== 'status') for (const col of columnsOf(field)) copied[col] = other[col]
  const statusFromOther = chosen.includes('status') && other.status !== master.status
  const statusKindOfOther = statusFromOther ? ((await statusKind(other.status)) ?? 'open') : null
  const cifFromOther = chosen.includes('cif') && other.cif !== null

  const M = sql`${masterId}::uuid`
  const O = sql`${otherId}::uuid`
  const masterSequences = sql`(SELECT m.sequence_id FROM email_sequence_enrollments m WHERE m.prospect_id = ${M} AND m.deleted_at IS NULL)`

  await db.transaction(async (tx) => {
    // The unique index on (tenant, cif) also covers deleted rows, so the CIF must leave the old row first.
    if (cifFromOther) await tx.update(prospects).set({ cif: null }).where(eq(prospects.id, otherId))
    await tx
      .update(prospects)
      .set({ ...(copied as Partial<typeof prospects.$inferInsert>), updatedAt: new Date() })
      .where(eq(prospects.id, masterId))
    if (statusKindOfOther) await changeStatus(tx, master, other.status, statusKindOfOther, me.id, other.lostReason)

    await tx.execute(sql`UPDATE prospect_people SET prospect_id = ${M}, updated_at = now() WHERE prospect_id = ${O}`)
    // A point the master already has (same kind and normalized value) is dropped, not moved; the master keeps the primary.
    await tx.execute(sql`
      UPDATE prospect_contact_points o SET deleted_at = now(), updated_at = now(), is_primary = false
       WHERE o.prospect_id = ${O} AND o.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM prospect_contact_points m WHERE m.prospect_id = ${M} AND m.deleted_at IS NULL AND m.kind = o.kind AND m.value_normalized = o.value_normalized)`)
    await tx.execute(sql`
      UPDATE prospect_contact_points o SET is_primary = false
       WHERE o.prospect_id = ${O} AND o.is_primary AND o.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM prospect_contact_points m WHERE m.prospect_id = ${M} AND m.deleted_at IS NULL AND m.is_primary AND m.kind = o.kind)`)
    await tx.execute(sql`UPDATE prospect_contact_points SET prospect_id = ${M}, updated_at = now() WHERE prospect_id = ${O}`)
    await tx.execute(sql`UPDATE prospect_notes SET prospect_id = ${M}, updated_at = now() WHERE prospect_id = ${O}`)
    await tx.execute(sql`UPDATE prospect_voice_notes SET prospect_id = ${M}, updated_at = now() WHERE prospect_id = ${O}`)
    await tx.execute(sql`UPDATE prospect_tasks SET prospect_id = ${M}, updated_at = now() WHERE prospect_id = ${O}`)
    await tx.execute(sql`UPDATE prospect_stage_events SET prospect_id = ${M}, updated_at = now() WHERE prospect_id = ${O}`)
    await tx.execute(sql`UPDATE calls SET prospect_id = ${M}, updated_at = now() WHERE prospect_id = ${O}`)

    await tx.execute(sql`
      INSERT INTO prospect_list_members (tenant_id, list_id, prospect_id, added_by_user_id)
      SELECT tenant_id, list_id, ${M}, added_by_user_id FROM prospect_list_members WHERE prospect_id = ${O}
      ON CONFLICT DO NOTHING`)
    await tx.execute(sql`DELETE FROM prospect_list_members WHERE prospect_id = ${O}`)

    // The unique key is (sequence, email), so re-pointing never collides; what must not happen is the
    // same sequence mailing one company twice. Those enrollments stay on the old row and stop.
    await tx.execute(sql`
      UPDATE email_sequence_enrollments SET status = CASE WHEN status = 'active' THEN 'completed' ELSE status END, updated_at = now()
       WHERE prospect_id = ${O} AND sequence_id IN ${masterSequences}`)
    await tx.execute(sql`
      UPDATE email_sequence_enrollments SET prospect_id = ${M}, updated_at = now()
       WHERE prospect_id = ${O} AND sequence_id NOT IN ${masterSequences}`)

    await tx.execute(sql`
      UPDATE prospect_collaborators m SET level = 'edit', updated_at = now()
        FROM prospect_collaborators o
       WHERE m.prospect_id = ${M} AND o.prospect_id = ${O} AND o.user_id = m.user_id
         AND m.deleted_at IS NULL AND o.deleted_at IS NULL AND o.level = 'edit' AND m.level = 'view'`)
    // The unique index counts deleted rows too, so "already there" means any row of that user.
    await tx.execute(sql`
      UPDATE prospect_collaborators SET prospect_id = ${M}, updated_at = now()
       WHERE prospect_id = ${O} AND deleted_at IS NULL
         AND user_id NOT IN (SELECT user_id FROM prospect_collaborators WHERE prospect_id = ${M})`)

    await tx.execute(sql`
      INSERT INTO prospect_archives (tenant_id, prospect_id, user_id, archived_at)
      SELECT tenant_id, ${M}, user_id, archived_at FROM prospect_archives WHERE prospect_id = ${O}
      ON CONFLICT DO NOTHING`)
    await tx.execute(sql`DELETE FROM prospect_archives WHERE prospect_id = ${O}`)
    // Recomputed by the nightly run for the master.
    await tx.execute(sql`DELETE FROM prospect_signal_hits WHERE prospect_id = ${O}`)
    await tx.execute(sql`
      UPDATE prospect_transfer_requests SET status = 'cancelled', decided_at = now(), updated_at = now()
       WHERE prospect_id = ${O} AND status = 'pending'`)

    await tx.execute(sql`
      UPDATE prospects SET last_activity_at = GREATEST(last_activity_at, (SELECT last_activity_at FROM prospects WHERE id = ${O})),
                           last_contacted_at = GREATEST(last_contacted_at, (SELECT last_contacted_at FROM prospects WHERE id = ${O}))
       WHERE id = ${M}`)
    // Links of earlier merges into the old row follow it to the master.
    await tx.execute(sql`UPDATE prospects SET merged_into_id = ${M} WHERE merged_into_id = ${O}`)
    await tx.execute(sql`UPDATE prospects SET merged_into_id = ${M}, deleted_at = now(), updated_at = now() WHERE id = ${O}`)

    const actor = { actorUserId: me.id, entityType: 'prospect', ip: currentActor().ip }
    const onMaster: Record<string, [unknown, unknown]> = { mergedFrom: [null, otherId], fields: [null, choices] }
    const onOther: Record<string, [unknown, unknown]> = { mergedInto: [null, masterId] }
    if (cifFromOther) onOther.cif = [other.cif, null]
    await tx.insert(auditLog).values([
      { ...actor, action: 'prospect.unit', entityId: masterId, changes: onMaster },
      { ...actor, action: 'prospect.unit.in', entityId: otherId, changes: onOther },
    ])
  })

  await refreshScore(masterId)
  await dropPairsOf(otherId)
  return getProspectSheet(me, masterId)
}
