import { and, asc, desc, eq, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { prospects, prospectStatuses } from '../../shared/db/schema/index.js'
import { getCompany } from '../../shared/lib/company.js'
import { isDisplayCurrency } from '../../shared/lib/locale.js'
import { canReassign, PROSPECT_ID } from '../../shared/lib/prospect-access.js'
import { displayAmountSql } from '../../shared/lib/sql-fx.js'
import type { SessionUser } from '../../shared/lib/session.js'
import type { ProspectFilter } from './filters.js'
import { filterContext, prospectWhere, rowColumns } from './service.js'

type Me = Pick<SessionUser, 'id' | 'features'> & { tenant?: SessionUser['tenant'] }
interface FilterInput {
  f: ProspectFilter[]
  q?: string
}
interface Sum {
  currency: string
  amount: number
}

/** Cards per column on the board and rows per "load more" page. */
export const BOARD_PAGE_SIZE = 50

const openTask = (alias: string) => `${alias}."done_at" IS NULL AND ${alias}."skipped_at" IS NULL AND ${alias}."deleted_at" IS NULL`

// Earliest open task first, tasks-less last, then the hottest. Same order for the first cards and for "load more".
const nextDue = sql`(SELECT min(t."due_at") FROM prospect_tasks t WHERE t."prospect_id" = ${PROSPECT_ID} AND ${sql.raw(openTask('t'))})`
const cardOrder = () => [sql`${nextDue} ASC NULLS LAST`, desc(prospects.score), asc(prospects.id)] as const

const activeStatuses = () =>
  db
    .select({ key: prospectStatuses.key, label: prospectStatuses.label, kind: prospectStatuses.kind })
    .from(prospectStatuses)
    .where(isNull(prospectStatuses.deletedAt))
    .orderBy(asc(prospectStatuses.sortOrder), asc(prospectStatuses.key))

const round2 = (n: number) => Math.round(n * 100) / 100

// ── Board ────────────────────────────────────────────────────────────────────

export async function getBoard(me: Me, input: FilterInput, cardLimit = BOARD_PAGE_SIZE) {
  const ctx = await filterContext(me)
  const where = await prospectWhere(me, input)
  const company = await getCompany()
  const target = isDisplayCurrency(company.currency) ? company.currency : null

  // A rate is read at today's BNR value: the board is a snapshot of what is open now, not a ledger.
  const converted = target ? displayAmountSql(prospects.valueAmount, prospects.valueCurrency, sql`now()`, target) : sql`NULL::numeric`
  const ranked = db
    .select({
      id: prospects.id,
      rn: sql<number>`row_number() OVER (PARTITION BY ${prospects.status} ORDER BY ${nextDue} ASC NULLS LAST, ${prospects.score} DESC NULLS LAST, ${prospects.id})`.as('rn'),
    })
    .from(prospects)
    .where(where)
    .as('ranked')

  const [catalog, groups, cardRows] = await Promise.all([
    activeStatuses(),
    db
      .select({
        status: prospects.status,
        currency: prospects.valueCurrency,
        count: sql<number>`count(*)::int`,
        amount: sql<string | null>`sum(${prospects.valueAmount})::text`,
        converted: sql<string | null>`sum(${converted})::text`,
      })
      .from(prospects)
      .where(where)
      .groupBy(prospects.status, prospects.valueCurrency),
    db
      .select(rowColumns(ctx))
      .from(prospects)
      .where(inArray(prospects.id, db.select({ id: ranked.id }).from(ranked).where(lte(ranked.rn, cardLimit))))
      .orderBy(...cardOrder()),
  ])

  const columns = catalog.map((s) => ({ status: s.key, label: s.label, kind: s.kind }))
  const known = new Set(columns.map((c) => c.status))
  // A prospect whose status left the catalog still has to be on the board.
  const orphans = [...new Set([...groups.map((g) => g.status), ...cardRows.map((c) => c.status)])].filter((s) => !known.has(s)).sort()
  for (const key of orphans) columns.push({ status: key, label: key, kind: 'open' })

  return {
    columns: columns.map((col) => {
      const own = groups.filter((g) => g.status === col.status)
      const sums: Sum[] = own.filter((g) => g.currency && g.amount !== null).map((g) => ({ currency: g.currency!, amount: Number(g.amount) }))
      return {
        ...col,
        count: own.reduce((n, g) => n + g.count, 0),
        sums,
        // null when the company currency has no BNR feed (not RON/EUR/USD): the per-currency sums still tell the truth.
        sumInCompanyCurrency: target ? round2(own.reduce((n, g) => n + Number(g.converted ?? 0), 0)) : null,
        cards: cardRows.filter((c) => c.status === col.status),
      }
    }),
  }
}

export async function getBoardColumn(me: Me, input: FilterInput & { status: string; page?: number }) {
  const ctx = await filterContext(me)
  const where = and(await prospectWhere(me, input), eq(prospects.status, input.status))
  const page = Math.max(1, input.page ?? 1)
  const [cards, [{ total } = { total: 0 }]] = await Promise.all([
    db
      .select(rowColumns(ctx))
      .from(prospects)
      .where(where)
      .orderBy(...cardOrder())
      .limit(BOARD_PAGE_SIZE)
      .offset((page - 1) * BOARD_PAGE_SIZE),
    db.select({ total: sql<number>`count(*)::int` }).from(prospects).where(where),
  ])
  return { cards, total }
}

// ── Forecast ─────────────────────────────────────────────────────────────────

export async function getForecast(me: Me, input: FilterInput & { months: number }) {
  const where = await prospectWhere(me, input)
  const tz = (await filterContext(me)).timeZone
  const openOnly = sql`${prospects.status} IN (SELECT s."key" FROM prospect_statuses s WHERE s."kind" = 'open' AND s."deleted_at" IS NULL)`

  const [{ current } = { current: '' }] = await db.execute<{ current: string }>(sql`SELECT to_char(now() AT TIME ZONE ${tz}, 'YYYY-MM') AS current`)
  const monthKeys = Array.from({ length: input.months }, (_, i) => {
    const [y, m] = current.split('-').map(Number) as [number, number]
    const d = new Date(Date.UTC(y, m - 1 + i, 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  })

  const currentMonthStart = sql`date_trunc('month', (now() AT TIME ZONE ${tz})::date)`
  // An overdue close date is still a deal to close: it counts in the current month, not in the past.
  const month = sql<string | null>`CASE WHEN ${prospects.expectedCloseAt} IS NULL THEN NULL ELSE to_char(GREATEST(date_trunc('month', ${prospects.expectedCloseAt}), ${currentMonthStart}), 'YYYY-MM') END`
  const rows = await db
    .select({
      month,
      currency: prospects.valueCurrency,
      count: sql<number>`count(*)::int`,
      amount: sql<string | null>`sum(${prospects.valueAmount})::text`,
    })
    .from(prospects)
    .where(
      and(
        where,
        openOnly,
        sql`(${prospects.expectedCloseAt} IS NULL OR ${prospects.expectedCloseAt} < ${currentMonthStart} + (${input.months} * interval '1 month'))`,
      ),
    )
    // By position: the time zone is a bound parameter, and a second copy of the expression would not match the select.
    .groupBy(sql`1`, sql`2`)

  const bucket = (key: string | null) => {
    const own = rows.filter((r) => r.month === key)
    return {
      count: own.reduce((n, r) => n + r.count, 0),
      sums: own.filter((r) => r.currency && r.amount !== null).map((r) => ({ currency: r.currency!, amount: Number(r.amount) })),
    }
  }
  return { months: monthKeys.map((key) => ({ month: key, ...bucket(key) })), undated: bucket(null) }
}

// ── Funnel ───────────────────────────────────────────────────────────────────

export async function getFunnel(me: Me, input: FilterInput & { from: string; to: string }) {
  const where = await prospectWhere(me, input)
  const tz = (await filterContext(me)).timeZone
  const stages = (await activeStatuses()).filter((s) => s.kind !== 'lost')
  if (!stages.length) return { stages: [] }

  const values = sql.join(stages.map((s, i) => sql`(${s.key}::text, ${i}::int)`), sql`, `)
  const visible = db.select({ id: prospects.id }).from(prospects).where(where)
  // The highest stage a prospect reached inside the interval; reaching stage 4 means passing 1-3.
  const rows = await db.execute<{ ord: number; reached: number }>(sql`
    WITH stages(key, ord) AS (VALUES ${values}),
    furthest AS (
      SELECT e."prospect_id", max(s.ord) AS ord
      FROM prospect_stage_events e
      JOIN stages s ON s.key = e."to_status"
      WHERE e."deleted_at" IS NULL
        AND e."prospect_id" IN (${visible})
        AND e."changed_at" >= (${input.from}::date)::timestamp AT TIME ZONE ${tz}
        AND e."changed_at" < ((${input.to}::date + 1))::timestamp AT TIME ZONE ${tz}
      GROUP BY e."prospect_id"
    )
    SELECT s.ord, count(f."prospect_id")::int AS reached
    FROM stages s
    LEFT JOIN furthest f ON f.ord >= s.ord
    GROUP BY s.ord
  `)
  const reachedAt = new Map(rows.map((r) => [Number(r.ord), Number(r.reached)]))
  return {
    stages: stages.map((s, i) => {
      const reached = reachedAt.get(i) ?? 0
      const previous = i > 0 ? (reachedAt.get(i - 1) ?? 0) : 0
      return { status: s.key, label: s.label, reached, conversionFromPrevious: i > 0 && previous > 0 ? Math.round((reached / previous) * 1000) / 1000 : null }
    }),
  }
}

// ── Per agent ────────────────────────────────────────────────────────────────

export async function getStatsByAgent(me: Me, input: { from: string; to: string }) {
  const tz = (await filterContext(me)).timeZone
  const today = sql`(now() AT TIME ZONE ${tz})::date`
  const day = (col: string) => sql`((${sql.raw(col)} AT TIME ZONE ${tz})::date = ${today})`
  const kindKeys = (kind: 'open' | 'won') => sql`(SELECT s."key" FROM prospect_statuses s WHERE s."kind" = ${kind} AND s."deleted_at" IS NULL)`
  const mine = sql`p."assigned_user_id" = u."id" AND p."deleted_at" IS NULL`

  // Without repartizare: only your own row. With it: whoever holds a prospect, plus you.
  const people: SQL = canReassign(me)
    ? sql`(u."id" = ${me.id} OR EXISTS (SELECT 1 FROM prospects p WHERE ${mine}))`
    : sql`u."id" = ${me.id}`

  const rows = await db.execute<{ userId: string; name: string; claimed: number; contactedToday: number; withoutNextStep: number; won: number }>(sql`
    SELECT u."id" AS "userId",
      coalesce(nullif(u."display_name", ''), u."email") AS name,
      (SELECT count(*)::int FROM prospects p WHERE ${mine}) AS claimed,
      (SELECT count(*)::int FROM prospects p WHERE ${mine} AND (
        EXISTS (SELECT 1 FROM prospect_tasks t WHERE t."prospect_id" = p."id" AND t."deleted_at" IS NULL AND t."assignee_user_id" = u."id" AND t."done_at" IS NOT NULL AND ${day('t."done_at"')})
        OR EXISTS (SELECT 1 FROM email_sends es JOIN prospect_contact_points cp ON cp."value_normalized" = lower(es."recipient")
                   WHERE cp."prospect_id" = p."id" AND cp."kind" = 'email' AND cp."deleted_at" IS NULL
                     AND es."deleted_at" IS NULL AND es."sent_by_user_id" = u."id" AND es."status" NOT IN ('scheduled', 'cancelled', 'failed')
                     AND ${day('es."created_at"')})
      )) AS "contactedToday",
      (SELECT count(*)::int FROM prospects p WHERE ${mine} AND p."status" IN ${kindKeys('open')}
        AND NOT EXISTS (SELECT 1 FROM prospect_tasks t WHERE t."prospect_id" = p."id" AND ${sql.raw(openTask('t'))})) AS "withoutNextStep",
      (SELECT count(*)::int FROM prospects p WHERE ${mine} AND EXISTS (
        SELECT 1 FROM prospect_stage_events e WHERE e."prospect_id" = p."id" AND e."deleted_at" IS NULL AND e."to_status" IN ${kindKeys('won')}
          AND e."changed_at" >= (${input.from}::date)::timestamp AT TIME ZONE ${tz}
          AND e."changed_at" < ((${input.to}::date + 1))::timestamp AT TIME ZONE ${tz})) AS won
    FROM users u
    WHERE u."status" = 'active' AND u."deleted_at" IS NULL AND ${people}
    ORDER BY lower(coalesce(nullif(u."display_name", ''), u."email")), u."id"
  `)
  return rows.map((r) => ({ userId: r.userId, name: r.name, claimed: r.claimed, contactedToday: r.contactedToday, withoutNextStep: r.withoutNextStep, won: r.won }))
}
