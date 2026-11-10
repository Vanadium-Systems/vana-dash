import { sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import {
  emailSequenceEnrollments,
  emailSends,
  prospectArchives,
  prospectContactPoints,
  prospectListMembers,
  prospectPeople,
  prospects,
  prospectSignalHits,
  prospectTasks,
} from '../../shared/db/schema/index.js'
import { escapeLike, visibleProspectsWhere } from '../../shared/lib/prospect-access.js'
import type { SessionUser } from '../../shared/lib/session.js'

// The one filter compiler (list, count, board, aggregates, export, lists from search, view alerts,
// signals, score criteria, natural-language search). Fields are a whitelist and every value is a
// bound parameter: no SQL is ever built from user text.

export const FILTER_FIELDS = [
  'status',
  'owner',
  'score',
  'priority',
  'source',
  'caen',
  'employees',
  'revenue',
  'value',
  'expectedCloseAt',
  'lastActivityAt',
  'createdAt',
  'nextTask',
  'list',
  'sequence',
  'emailEvent',
  'isActive',
  'archived',
  'signal',
  'phone',
  'email',
  'contactStatus',
  'foundingYear',
  'people.role',
  'people.decisionMaker',
  'people.doNotContact',
] as const
export type FilterField = (typeof FILTER_FIELDS)[number]

const value = z.union([z.string().max(200), z.number()])
export const ProspectFilterSchema = z.discriminatedUnion('op', [
  z.object({ field: z.enum(FILTER_FIELDS), op: z.enum(['in', 'not_in']), value: z.array(z.string().max(200)).min(1).max(200) }),
  z.object({ field: z.enum(FILTER_FIELDS), op: z.literal('between'), value: z.tuple([value.nullable(), value.nullable()]) }),
  z.object({ field: z.enum(FILTER_FIELDS), op: z.enum(['is_empty', 'not_empty']) }),
])
export type ProspectFilter = z.infer<typeof ProspectFilterSchema>
export const ProspectFiltersSchema = z.array(ProspectFilterSchema).max(40)

/** `?f=` is compact JSON, URL-encoded by the client. Unknown fields or bad shapes → 400. */
export const FiltersParamSchema = z
  .string()
  .max(8000)
  .optional()
  .transform((raw, ctx) => {
    if (!raw) return [] as ProspectFilter[]
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'f: invalid JSON' })
      return z.NEVER
    }
    const result = ProspectFiltersSchema.safeParse(parsed)
    if (!result.success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `f: ${result.error.issues[0]?.message ?? 'invalid'}` })
      return z.NEVER
    }
    return result.data
  })

export interface FilterContext {
  me: Pick<SessionUser, 'id' | 'features'>
  kind: 'companies' | 'people'
  timeZone: string
  thresholds: { hot: number; warm: number; nurture: number }
}

export function priorityCase(t: FilterContext['thresholds']): SQL<string> {
  return sql<string>`CASE
    WHEN ${prospects.score} >= ${t.hot} THEN 'HOT'
    WHEN ${prospects.score} >= ${t.warm} THEN 'WARM'
    WHEN ${prospects.score} >= ${t.nurture} THEN 'NURTURE'
    ELSE 'SKIP' END`
}

const exists = (inner: SQL) => sql`EXISTS (${inner})`
const or = (parts: SQL[]) => (parts.length === 0 ? sql`false` : sql`(${sql.join(parts, sql` OR `)})`)

function inList(op: 'in' | 'not_in', column: SQL | typeof prospects.status, values: string[]): SQL {
  const list = sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )
  return op === 'in' ? sql`${column} IN (${list})` : sql`(${column} IS NULL OR ${column} NOT IN (${list}))`
}

function between(column: SQL | typeof prospects.score, [from, to]: [string | number | null, string | number | null], cast?: 'timestamptz' | 'date') {
  const val = (v: string | number) => (cast ? sql`${String(v)}::${sql.raw(cast)}` : sql`${v}`)
  const parts: SQL[] = []
  if (from !== null && from !== '') parts.push(sql`${column} >= ${val(from)}`)
  if (to !== null && to !== '') parts.push(sql`${column} <= ${val(to)}`)
  return parts.length ? sql.join(parts, sql` AND `) : sql`true`
}

/** Keeps the filters an `in` / `not_in` op on an EXISTS: `not_in` negates the whole subquery. */
function existsOp(op: 'in' | 'not_in', inner: SQL): SQL {
  return op === 'in' ? exists(inner) : sql`NOT ${exists(inner)}`
}

const peopleOf = (extra: SQL) =>
  sql`SELECT 1 FROM ${prospectPeople} pp WHERE pp."prospect_id" = ${prospects.id} AND pp."deleted_at" IS NULL AND ${extra}`

function compileOne(f: ProspectFilter, ctx: FilterContext): SQL {
  const empty = f.op === 'is_empty'
  switch (f.field) {
    case 'status':
      if (f.op === 'in' || f.op === 'not_in') return inList(f.op, prospects.status, f.value)
      break
    case 'owner': {
      if (f.op === 'is_empty' || f.op === 'not_empty') return empty ? sql`${prospects.assignedUserId} IS NULL` : sql`${prospects.assignedUserId} IS NOT NULL`
      if (f.op !== 'in' && f.op !== 'not_in') break
      const parts = f.value.map((v) => {
        if (v === 'me') return sql`${prospects.assignedUserId} = ${ctx.me.id}`
        if (v === 'free') return sql`${prospects.assignedUserId} IS NULL`
        return z.string().uuid().safeParse(v).success ? sql`${prospects.assignedUserId} = ${v}` : sql`false`
      })
      return f.op === 'in' ? or(parts) : sql`NOT ${or(parts)}`
    }
    case 'priority':
      if (f.op === 'in' || f.op === 'not_in') return inList(f.op, priorityCase(ctx.thresholds), f.value)
      break
    case 'source':
      if (f.op === 'in' || f.op === 'not_in') return inList(f.op, prospects.source as never, f.value)
      return empty ? sql`coalesce(${prospects.source}, '') = ''` : sql`coalesce(${prospects.source}, '') <> ''`
    case 'caen': {
      if (f.op === 'is_empty' || f.op === 'not_empty') return empty ? sql`coalesce(${prospects.caenCode}, '') = ''` : sql`coalesce(${prospects.caenCode}, '') <> ''`
      if (f.op !== 'in' && f.op !== 'not_in') break
      // A CAEN prefix ("38") matches its whole class ("3811", "3821").
      const parts = f.value.map((v) => sql`${prospects.caenCode} LIKE ${escapeLike(v) + '%'}`)
      return f.op === 'in' ? or(parts) : sql`(${prospects.caenCode} IS NULL OR NOT ${or(parts)})`
    }
    case 'score':
    case 'employees':
    case 'revenue':
    case 'value':
    case 'foundingYear': {
      const column = {
        score: prospects.score,
        employees: prospects.employeeCount,
        revenue: prospects.revenue,
        value: prospects.valueAmount,
        foundingYear: prospects.foundingYear,
      }[f.field]
      if (f.op === 'between') return between(column as never, f.value)
      if (f.op === 'is_empty') return sql`${column} IS NULL`
      if (f.op === 'not_empty') return sql`${column} IS NOT NULL`
      break
    }
    case 'expectedCloseAt':
    case 'lastActivityAt':
    case 'createdAt': {
      const column = { expectedCloseAt: prospects.expectedCloseAt, lastActivityAt: prospects.lastActivityAt, createdAt: prospects.createdAt }[f.field]
      if (f.op === 'between') return between(column as never, f.value, f.field === 'expectedCloseAt' ? 'date' : 'timestamptz')
      if (f.op === 'is_empty') return sql`${column} IS NULL`
      if (f.op === 'not_empty') return sql`${column} IS NOT NULL`
      break
    }
    case 'nextTask': {
      if (f.op !== 'in' && f.op !== 'not_in') break
      const open = sql`t."prospect_id" = ${prospects.id} AND t."done_at" IS NULL AND t."skipped_at" IS NULL AND t."deleted_at" IS NULL`
      const today = sql`(now() AT TIME ZONE ${ctx.timeZone})::date`
      const day = sql`(t."due_at" AT TIME ZONE ${ctx.timeZone})::date`
      const parts = f.value.map((v) => {
        if (v === 'none') return sql`NOT EXISTS (SELECT 1 FROM ${prospectTasks} t WHERE ${open})`
        if (v === 'overdue') return exists(sql`SELECT 1 FROM ${prospectTasks} t WHERE ${open} AND ${day} < ${today}`)
        if (v === 'today') return exists(sql`SELECT 1 FROM ${prospectTasks} t WHERE ${open} AND ${day} = ${today}`)
        if (v === 'future') return exists(sql`SELECT 1 FROM ${prospectTasks} t WHERE ${open} AND ${day} > ${today}`)
        return sql`false`
      })
      return f.op === 'in' ? or(parts) : sql`NOT ${or(parts)}`
    }
    case 'list':
      if (f.op === 'in' || f.op === 'not_in') {
        const ids = f.value.filter((v) => z.string().uuid().safeParse(v).success)
        if (ids.length === 0) return f.op === 'in' ? sql`false` : sql`true`
        return existsOp(
          f.op,
          sql`SELECT 1 FROM ${prospectListMembers} m WHERE m."prospect_id" = ${prospects.id} AND m."deleted_at" IS NULL AND m."list_id" IN (${sql.join(
            ids.map((v) => sql`${v}`),
            sql`, `,
          )})`,
        )
      }
      return existsOp(empty ? 'not_in' : 'in', sql`SELECT 1 FROM ${prospectListMembers} m WHERE m."prospect_id" = ${prospects.id} AND m."deleted_at" IS NULL`)
    case 'sequence': {
      const active = sql`e."prospect_id" = ${prospects.id} AND e."deleted_at" IS NULL AND e."status" = 'active'`
      if (f.op === 'in' || f.op === 'not_in') {
        const ids = f.value.filter((v) => z.string().uuid().safeParse(v).success)
        if (ids.length === 0) return f.op === 'in' ? sql`false` : sql`true`
        return existsOp(
          f.op,
          sql`SELECT 1 FROM ${emailSequenceEnrollments} e WHERE ${active} AND e."sequence_id" IN (${sql.join(
            ids.map((v) => sql`${v}`),
            sql`, `,
          )})`,
        )
      }
      return existsOp(empty ? 'not_in' : 'in', sql`SELECT 1 FROM ${emailSequenceEnrollments} e WHERE ${active}`)
    }
    case 'emailEvent': {
      if (f.op !== 'in' && f.op !== 'not_in') break
      // Email activity reaches a prospect through its email contact points.
      const toProspect = sql`SELECT 1 FROM ${emailSends} s JOIN ${prospectContactPoints} cp
        ON cp."kind" = 'email' AND cp."deleted_at" IS NULL AND cp."value_normalized" = lower(s."recipient")
        WHERE cp."prospect_id" = ${prospects.id} AND s."deleted_at" IS NULL`
      const parts = f.value.map((v) => {
        if (v === 'opened') return exists(sql`${toProspect} AND s."opened_at" IS NOT NULL`)
        if (v === 'clicked') return exists(sql`${toProspect} AND s."clicked_at" IS NOT NULL`)
        if (v === 'bounced') return exists(sql`${toProspect} AND s."status" = 'bounced'`)
        if (v === 'replied')
          return exists(sql`SELECT 1 FROM ${emailSequenceEnrollments} e WHERE e."prospect_id" = ${prospects.id} AND e."status" = 'replied'`)
        if (v === 'unsubscribed')
          return exists(sql`SELECT 1 FROM ${prospectContactPoints} cp WHERE cp."prospect_id" = ${prospects.id} AND cp."status" = 'unsubscribed' AND cp."deleted_at" IS NULL`)
        return sql`false`
      })
      return f.op === 'in' ? or(parts) : sql`NOT ${or(parts)}`
    }
    case 'isActive':
      if (f.op === 'in' || f.op === 'not_in') {
        const wantActive = f.value.includes('true')
        const cond = wantActive ? sql`${prospects.isActive} IS NOT FALSE` : sql`${prospects.isActive} IS FALSE`
        return f.op === 'in' ? cond : sql`NOT (${cond})`
      }
      break
    case 'archived': {
      // Archiving is per person: ['yes'] = only mine archived, ['any'] = archived or not.
      const mine = sql`EXISTS (SELECT 1 FROM ${prospectArchives} a WHERE a."prospect_id" = ${prospects.id} AND a."user_id" = ${ctx.me.id})`
      if (f.op === 'in' && f.value.includes('any')) return sql`true`
      if (f.op === 'in' && f.value.includes('yes')) return mine
      return sql`NOT ${mine}`
    }
    case 'signal':
      if (f.op === 'in' || f.op === 'not_in') {
        const ids = f.value.filter((v) => z.string().uuid().safeParse(v).success)
        if (ids.length === 0) return f.op === 'in' ? sql`false` : sql`true`
        return existsOp(
          f.op,
          sql`SELECT 1 FROM ${prospectSignalHits} h WHERE h."prospect_id" = ${prospects.id} AND h."deleted_at" IS NULL AND h."signal_id" IN (${sql.join(
            ids.map((v) => sql`${v}`),
            sql`, `,
          )})`,
        )
      }
      break
    case 'phone':
    case 'email': {
      const has = sql`SELECT 1 FROM ${prospectContactPoints} cp WHERE cp."prospect_id" = ${prospects.id} AND cp."deleted_at" IS NULL AND cp."kind" = ${f.field} AND cp."status" = 'ok'`
      if (f.op === 'is_empty') return sql`NOT ${exists(has)}`
      if (f.op === 'not_empty') return exists(has)
      break
    }
    case 'contactStatus':
      if (f.op === 'in' || f.op === 'not_in') {
        return existsOp(
          f.op,
          sql`SELECT 1 FROM ${prospectContactPoints} cp WHERE cp."prospect_id" = ${prospects.id} AND cp."deleted_at" IS NULL AND cp."status" IN (${sql.join(
            f.value.map((v) => sql`${v}`),
            sql`, `,
          )})`,
        )
      }
      break
    case 'people.role':
    case 'people.decisionMaker':
    case 'people.doNotContact': {
      // On the people list the row is the person; on companies, "has such a person".
      const col = (name: 'role' | 'is_decision_maker' | 'do_not_contact') =>
        ctx.kind === 'people' ? sql`${prospectPeople}.${sql.identifier(name)}` : sql`pp.${sql.identifier(name)}`
      const cond =
        f.field === 'people.role'
          ? f.op === 'in' || f.op === 'not_in'
            ? or(f.value.map((v) => sql`${col('role')} ILIKE ${'%' + escapeLike(v) + '%'}`))
            : sql`coalesce(${col('role')}, '') <> ''`
          : f.field === 'people.decisionMaker'
            ? col('is_decision_maker')
            : col('do_not_contact')
      const negate = f.op === 'not_in' || f.op === 'is_empty'
      if (ctx.kind === 'people') return negate ? sql`NOT (${cond})` : cond
      return negate ? sql`NOT ${exists(peopleOf(cond))}` : exists(peopleOf(cond))
    }
  }
  throw new FilterOpError(f.field, f.op)
}

export class FilterOpError extends Error {
  readonly statusCode = 400
  constructor(field: string, op: string) {
    super(`filter ${field}: operator ${op} not supported`)
  }
}

/** Every filter ANDed, always with visibility and without merged-away or deleted prospects.
 *  Unless an `archived` filter says otherwise, my archived prospects are left out. */
export function compileProspectFilters(filters: ProspectFilter[], ctx: FilterContext): SQL {
  const parts: SQL[] = [sql`${prospects.deletedAt} IS NULL`, visibleProspectsWhere(ctx.me)]
  if (!filters.some((f) => f.field === 'archived')) parts.push(compileOne({ field: 'archived', op: 'not_in', value: ['yes'] }, ctx))
  for (const f of filters) parts.push(compileOne(f, ctx))
  return sql.join(parts, sql` AND `)
}

/** Free-text search: no diacritics, LIKE wildcards escaped, across names, CIF, people and contact points. */
export function searchWhere(term: string): SQL {
  const fold = (s: SQL) => sql`translate(lower(${s}), 'ăâîșşțţ', 'aaisstt')`
  const like = '%' + escapeLike(term.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')) + '%'
  const digits = term.replace(/\D/g, '')
  const parts: SQL[] = [
    sql`${fold(sql`${prospects.name}`)} LIKE ${like}`,
    sql`${prospects.cifNormalized} LIKE ${'%' + escapeLike(term.toUpperCase().replace(/^\s*RO|\s/gi, '')) + '%'}`,
    exists(peopleOf(sql`${fold(sql`pp."name"`)} LIKE ${like}`)),
    exists(
      sql`SELECT 1 FROM ${prospectContactPoints} cp WHERE cp."prospect_id" = ${prospects.id} AND cp."deleted_at" IS NULL
          AND (cp."value_normalized" LIKE ${like}${digits.length >= 4 ? sql` OR regexp_replace(cp."value_normalized", '[^0-9]', '', 'g') LIKE ${'%' + digits + '%'}` : sql``})`,
    ),
  ]
  return or(parts)
}
