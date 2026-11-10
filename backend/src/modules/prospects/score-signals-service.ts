import { and, asc, eq, getTableColumns, gt, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { prospects, prospectSignalHits, prospectSignals, prospectViews } from '../../shared/db/schema/index.js'
import { getCompanyTimeZone } from '../../shared/lib/company.js'
import { tr } from '../../shared/lib/i18n.js'
import { canReassign, PROSPECT_ID } from '../../shared/lib/prospect-access.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { compileProspectFilters, ProspectFiltersSchema, type FilterContext } from './filters.js'
import { maxCriteriaPoints } from './scoring.js'
import { ScoreCriterionSchema } from './schema.js'
import type { CreateSignalSchema, ScoringPreviewSchema, UpdateSignalSchema } from './score-signals-schema.js'
import { getScoringConfig, scoreHooks } from './service.js'

type Criterion = z.infer<typeof ScoreCriterionSchema>
type Config = Awaited<ReturnType<typeof getScoringConfig>>

const BATCH = 1000
const NIL_UUID = '00000000-0000-0000-0000-000000000000'

export class ScoringForbiddenError extends Error {
  readonly code = 'SCORING_FORBIDDEN'
}
export class SignalBuiltinError extends Error {
  readonly code = 'SIGNAL_BUILTIN'
}

/** The score and the signals are a decision of the company, not of whoever edits a prospect. */
export function assertCanConfigureScoring(me: Pick<SessionUser, 'features'>) {
  if (!canReassign(me)) throw new ScoringForbiddenError('SCORING_FORBIDDEN')
}

/** The four labels; without custom ones they are the hot / warm / nurture cut-offs. */
export function effectiveLabels(config: Config) {
  const stored = config.labels as { excellent: number; good: number; fit: number } | null
  return stored ?? { excellent: Number(config.hotThreshold), good: Number(config.warmThreshold), fit: Number(config.nurtureThreshold) }
}

function parseCriteria(raw: unknown): Criterion[] {
  const parsed = ScoreCriterionSchema.array().safeParse(raw)
  return parsed.success ? parsed.data : []
}

// The score and the signals belong to the company, so they are computed with total visibility: a
// synthetic user with `clienti.toti`, never the person who happened to trigger the recalculation.
async function companyContext(config: Config): Promise<FilterContext> {
  return {
    me: { id: NIL_UUID, features: ['clienti.toti'] },
    kind: 'companies',
    timeZone: await getCompanyTimeZone(),
    thresholds: { hot: Number(config.hotThreshold), warm: Number(config.warmThreshold), nurture: Number(config.nurtureThreshold) },
  }
}

async function* idBatches(ids?: string[]): AsyncGenerator<string[]> {
  if (ids) {
    for (let i = 0; i < ids.length; i += BATCH) yield ids.slice(i, i + BATCH)
    return
  }
  let after = NIL_UUID
  for (;;) {
    const rows = await db
      .select({ id: prospects.id })
      .from(prospects)
      .where(and(isNull(prospects.deletedAt), gt(prospects.id, after)))
      .orderBy(prospects.id)
      .limit(BATCH)
    if (rows.length === 0) return
    yield rows.map((r) => r.id)
    after = rows.at(-1)!.id
  }
}

const idList = (ids: string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )

// ── Final score ──────────────────────────────────────────────────────────────

/** SQL twin of `computeFinalScore`: the matched criteria are evaluated by the filter compiler, per row. */
function finalScoreSql(baseWeight: number, criteria: Criterion[], ctx: FilterContext): SQL {
  const maxPoints = maxCriteriaPoints(criteria)
  if (maxPoints === 0) return sql`${prospects.scoreBase}`
  const matched = criteria.map((c) => sql`(CASE WHEN ${compileProspectFilters(c.filters, ctx)} THEN ${c.points}::numeric ELSE 0 END)`)
  // Base 0 is the viability gate (a struck-off company): criteria do not lift it.
  return sql`(CASE WHEN ${prospects.scoreBase} = 0 THEN 0 ELSE round(100 * (${prospects.scoreBase} * ${baseWeight}::numeric + ${sql.join(matched, sql` + `)}) / (100 * ${baseWeight}::numeric + ${maxPoints}::numeric), 1) END)`
}

/** Writes the final score (base + criteria) for the given prospects, or for all of them. */
export async function applyCriteria(ids?: string[]) {
  const config = await getScoringConfig()
  const final = finalScoreSql(Number(config.baseWeight), parseCriteria(config.criteria), await companyContext(config))
  for await (const batch of idBatches(ids)) {
    await db.execute(sql`
      UPDATE ${prospects} SET "score" = ${final}
       WHERE ${PROSPECT_ID} IN (${idList(batch)}) AND ${prospects.deletedAt} IS NULL AND ${prospects.scoreBase} IS NOT NULL`)
  }
}

/** The label counts a draft config would give, without writing anything. */
export async function previewScoring(draft: z.infer<typeof ScoringPreviewSchema>) {
  const config = await getScoringConfig()
  const labels = draft.labels ?? effectiveLabels(config)
  const final = finalScoreSql(draft.baseWeight ?? Number(config.baseWeight), draft.criteria ?? parseCriteria(config.criteria), await companyContext(config))
  const [row] = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL statement_timeout = '3s'`)
    return tx.execute<{ total: number; excellent: number; good: number; fit: number }>(sql`
      SELECT count(*)::int AS total,
             (count(*) FILTER (WHERE s >= ${labels.excellent}))::int AS excellent,
             (count(*) FILTER (WHERE s >= ${labels.good} AND s < ${labels.excellent}))::int AS good,
             (count(*) FILTER (WHERE s >= ${labels.fit} AND s < ${labels.good}))::int AS fit
        FROM (SELECT ${final} AS s FROM ${prospects} WHERE ${prospects.deletedAt} IS NULL AND ${prospects.scoreBase} IS NOT NULL) scored`)
  })
  const total = row?.total ?? 0
  const [excellent, good, fit] = [row?.excellent ?? 0, row?.good ?? 0, row?.fit ?? 0]
  return {
    distribution: [
      { label: 'excellent' as const, count: excellent },
      { label: 'good' as const, count: good },
      { label: 'fit' as const, count: fit },
      { label: 'unfit' as const, count: total - excellent - good - fit },
    ],
    total,
  }
}

// ── Signals ──────────────────────────────────────────────────────────────────

type SignalRow = typeof prospectSignals.$inferSelect

// The built-in signals. The ones evaluated in code (the year, 30 days and growth move with time or
// are not expressible as a list filter) keep `filters` empty and descriptive: editing it changes
// nothing, only name, description, tip and `enabled` do. The others are evaluated from `filters`.
const BUILTINS = [
  { key: 'new_company', groupKey: 'company', filters: [] },
  { key: 'revenue_growth', groupKey: 'company', filters: [] },
  // Empty until the company fills in its target CAEN codes.
  { key: 'target_caen', groupKey: 'company', filters: [] },
  { key: 'engaged', groupKey: 'activity', filters: [{ field: 'emailEvent', op: 'in', value: ['opened', 'replied'] }] },
  { key: 'not_contacted', groupKey: 'activity', filters: [] },
  { key: 'decision_maker', groupKey: 'contact', filters: [{ field: 'people.decisionMaker', op: 'in', value: ['true'] }] },
] as const
type BuiltinKey = (typeof BUILTINS)[number]['key']
const CODE_EVALUATED: readonly string[] = ['new_company', 'revenue_growth', 'not_contacted'] satisfies BuiltinKey[]

/** Creates the missing built-in signals (texts in the company's language); returns the new ids. */
async function ensureBuiltinSignals(): Promise<string[]> {
  const existing = await db.select({ key: prospectSignals.builtinKey }).from(prospectSignals).where(and(isNotNull(prospectSignals.builtinKey), isNull(prospectSignals.deletedAt)))
  if (BUILTINS.every((b) => existing.some((e) => e.key === b.key))) return []
  return db.transaction(async (tx) => {
    // No unique index on (tenant, builtin_key): the lock keeps two first reads from both inserting.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('prospect_signals_builtin'))`)
    const have = await tx.select({ key: prospectSignals.builtinKey }).from(prospectSignals).where(and(isNotNull(prospectSignals.builtinKey), isNull(prospectSignals.deletedAt)))
    const created: string[] = []
    for (const b of BUILTINS) {
      if (have.some((h) => h.key === b.key)) continue
      const [row] = await tx
        .insert(prospectSignals)
        .values({
          name: tr(`prospectSignals.${b.key}.name`),
          groupKey: b.groupKey,
          description: tr(`prospectSignals.${b.key}.description`),
          talkingTip: tr(`prospectSignals.${b.key}.tip`),
          filters: b.filters,
          builtinKey: b.key,
        })
        .returning({ id: prospectSignals.id })
      created.push(row!.id)
    }
    return created
  })
}

function signalCondition(signal: SignalRow, ctx: FilterContext): SQL {
  switch (signal.builtinKey) {
    case 'new_company':
      // Founded this year or last: evaluated now, not when the signal was created.
      return compileProspectFilters([{ field: 'foundingYear', op: 'between', value: [new Date().getFullYear() - 1, null] }], ctx)
    case 'revenue_growth':
      return sql`(${prospects.revenue} > 0 AND ${prospects.revenuePrev} > 0 AND ${prospects.revenue} > ${prospects.revenuePrev} * 1.2)`
    case 'not_contacted':
      return sql`(${prospects.lastActivityAt} IS NULL OR ${prospects.lastActivityAt} < now() - interval '30 days')`
  }
  const filters = ProspectFiltersSchema.safeParse(signal.filters)
  return filters.success && filters.data.length > 0 ? compileProspectFilters(filters.data, ctx) : sql`false`
}

/**
 * Rewrites the hits of the active signals (all of them or one) for the given prospects or for
 * every prospect, in batches. Hits of a disabled signal are removed.
 */
export async function recomputeSignals(prospectIds?: string[], onlySignalId?: string) {
  if (!prospectIds && !onlySignalId) await ensureBuiltinSignals()
  const signals = await db
    .select()
    .from(prospectSignals)
    .where(and(isNull(prospectSignals.deletedAt), onlySignalId ? eq(prospectSignals.id, onlySignalId) : undefined))
  if (signals.length === 0) return
  const ctx = await companyContext(await getScoringConfig())
  const runAt = new Date().toISOString()
  for (const signal of signals) {
    const condition = signalCondition(signal, ctx)
    for await (const batch of idBatches(prospectIds)) {
      await db.delete(prospectSignalHits).where(and(eq(prospectSignalHits.signalId, signal.id), inArray(prospectSignalHits.prospectId, batch)))
      if (!signal.enabled) continue
      await db.execute(sql`
        INSERT INTO ${prospectSignalHits} ("signal_id", "prospect_id", "computed_at")
        SELECT ${signal.id}::uuid, ${PROSPECT_ID}, ${runAt}::timestamptz FROM ${prospects}
         WHERE ${PROSPECT_ID} IN (${idList(batch)}) AND ${prospects.deletedAt} IS NULL AND ${condition}
        ON CONFLICT DO NOTHING`)
    }
    // Hits of prospects deleted since the last run are in no batch.
    if (!prospectIds) {
      await db.delete(prospectSignalHits).where(and(eq(prospectSignalHits.signalId, signal.id), sql`${prospectSignalHits.computedAt} < ${runAt}::timestamptz`))
    }
  }
}

scoreHooks.afterBase = async (prospectId) => {
  await recomputeSignals([prospectId])
  await applyCriteria([prospectId])
}
scoreHooks.afterBatch = async (ids) => {
  await recomputeSignals(ids)
  await applyCriteria(ids)
}
scoreHooks.afterAll = () => applyCriteria()

// ── Signal CRUD ──────────────────────────────────────────────────────────────

const SIGNAL_ID = sql.raw('"prospect_signals"."id"')

async function signalItems(only?: string) {
  const config = await getScoringConfig()
  const inScore = (id: string) => parseCriteria(config.criteria).some((c) => c.filters.some((f) => f.field === 'signal' && 'value' in f && Array.isArray(f.value) && f.value.includes(id)))
  const rows = await db
    .select({
      ...getTableColumns(prospectSignals),
      hitCount: sql<number>`(SELECT count(*)::int FROM ${prospectSignalHits} h WHERE h."signal_id" = ${SIGNAL_ID} AND h."deleted_at" IS NULL)`,
      viewCount: sql<number>`(SELECT count(*)::int FROM ${prospectViews} v WHERE v."deleted_at" IS NULL AND v."filters"::text LIKE '%' || ${SIGNAL_ID}::text || '%')`,
    })
    .from(prospectSignals)
    .where(and(isNull(prospectSignals.deletedAt), only ? eq(prospectSignals.id, only) : undefined))
    .orderBy(asc(prospectSignals.createdAt))
  return rows.map(({ hitCount, viewCount, ...signal }) => ({ ...signal, hitCount, usedIn: { score: inScore(signal.id), views: viewCount } }))
}

export async function listSignals() {
  for (const id of await ensureBuiltinSignals()) await recomputeSignals(undefined, id)
  const items = await signalItems()
  return (['company', 'activity', 'contact'] as const).map((groupKey) => ({ groupKey, signals: items.filter((s) => s.groupKey === groupKey) }))
}

export async function createSignal(input: z.infer<typeof CreateSignalSchema>) {
  const [row] = await db
    .insert(prospectSignals)
    .values({ name: input.name, groupKey: input.groupKey, description: input.description ?? null, talkingTip: input.talkingTip ?? null, filters: input.filters, enabled: input.enabled ?? true })
    .returning({ id: prospectSignals.id })
  await recomputeSignals(undefined, row!.id)
  return (await signalItems(row!.id))[0]!
}

export async function updateSignal(id: string, input: z.infer<typeof UpdateSignalSchema>) {
  const [current] = await db.select().from(prospectSignals).where(and(eq(prospectSignals.id, id), isNull(prospectSignals.deletedAt)))
  if (!current) return undefined
  const { filters, ...rest } = input
  const keepFilters = current.builtinKey !== null && CODE_EVALUATED.includes(current.builtinKey)
  await db
    .update(prospectSignals)
    .set({ ...rest, ...(filters !== undefined && !keepFilters && { filters }), updatedAt: new Date() })
    .where(eq(prospectSignals.id, id))
  if (filters !== undefined || input.enabled !== undefined) await recomputeSignals(undefined, id)
  return (await signalItems(id))[0]!
}

export async function deleteSignal(id: string) {
  const [current] = await db.select().from(prospectSignals).where(and(eq(prospectSignals.id, id), isNull(prospectSignals.deletedAt)))
  if (!current) return false
  if (current.builtinKey !== null) throw new SignalBuiltinError('SIGNAL_BUILTIN')
  await db.update(prospectSignals).set({ deletedAt: new Date() }).where(eq(prospectSignals.id, id))
  await db.delete(prospectSignalHits).where(eq(prospectSignalHits.signalId, id))
  return true
}
