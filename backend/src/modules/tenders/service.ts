import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { tenderOpportunities, tenderWatchRules } from '../../shared/db/schema/index.js'
import type { CreateWatchRuleSchema, ListTendersQuerySchema, UpdateWatchRuleSchema } from './schema.js'
import type { NormalizedTenderRow } from './types.js'

type ListQuery = z.infer<typeof ListTendersQuerySchema>
type CreateWatchRuleInput = z.infer<typeof CreateWatchRuleSchema>
type UpdateWatchRuleInput = z.infer<typeof UpdateWatchRuleSchema>

// ── Oportunități ──────────────────────────────────────────────────────────

export async function listTenderOpportunities(query: ListQuery) {
  const conditions = [query.dismissed === 'only' ? isNotNull(tenderOpportunities.dismissedAt) : isNull(tenderOpportunities.dismissedAt)]
  // Lista principală arată doar ce se mai poate depune. is_open singur nu ajunge: un anunț
  // care iese din rezultatele SICAP nu mai e actualizat și rămâne „deschis" după termen.
  if (query.dismissed !== 'only') {
    conditions.push(
      eq(tenderOpportunities.isOpen, true),
      or(isNull(tenderOpportunities.deadlineAt), gte(tenderOpportunities.deadlineAt, sql`now()`))!,
    )
  }
  if (query.source) conditions.push(eq(tenderOpportunities.source, query.source))
  if (query.isPriority !== undefined) conditions.push(eq(tenderOpportunities.isPriority, query.isPriority))
  if (query.search) {
    const term = `%${query.search}%`
    conditions.push(or(ilike(tenderOpportunities.title, term), ilike(tenderOpportunities.contractingAuthority, term))!)
  }

  return db
    .select()
    .from(tenderOpportunities)
    .where(and(...conditions))
    // Prioritate înaltă întâi (iese în evidență — cerință Stefan 2026-09-14), apoi deadline
    // ascendent cu NULL la coadă (nu se pierd printre cele cu deadline apropiat).
    .orderBy(desc(tenderOpportunities.isPriority), asc(sql`${tenderOpportunities.deadlineAt} IS NULL`), asc(tenderOpportunities.deadlineAt))
}

export async function dismissTenderOpportunity(id: string) {
  const [row] = await db.update(tenderOpportunities).set({ dismissedAt: new Date(), updatedAt: new Date() }).where(eq(tenderOpportunities.id, id)).returning()
  return row
}

export async function undismissTenderOpportunity(id: string) {
  const [row] = await db.update(tenderOpportunities).set({ dismissedAt: null, updatedAt: new Date() }).where(eq(tenderOpportunities.id, id)).returning()
  return row
}

/**
 * Upsert pe `(source, externalId)` — pattern `upsertMetrics` (shared/lib/sync.ts). Trucul
 * `xmax = 0` (Postgres) distinge INSERT de UPDATE în același `RETURNING`, fără un SELECT
 * separat înainte — folosit de `jobs/tender-watch-sync.ts` ca să alerteze DOAR pe rândurile
 * chiar noi, nu pe cele doar reactualizate (ex. valoare/deadline schimbate).
 */
export async function upsertTenderOpportunities(
  rows: (NormalizedTenderRow & {
    matchedRuleId: string | null
    isPriority: boolean
    excludedByRule: boolean
    minTurnoverRon: number | null
    eligibilityNote: string | null
    ineligibleByTurnover: boolean
  })[],
): Promise<{
  inserted: number
  updated: number
  rows: { id: string; externalId: string; title: string; isPriority: boolean; detailUrl: string; inserted: boolean; dismissedAt: Date | null }[]
}> {
  if (rows.length === 0) return { inserted: 0, updated: 0, rows: [] }

  // The same notice can come twice in one run (two sources, or two pages of one listing), and
  // Postgres refuses an ON CONFLICT that touches one row twice in a statement. The last copy wins.
  const unique = [...new Map(rows.map((r) => [`${r.source}\u0000${r.externalId}`, r])).values()]

  const result = await db
    .insert(tenderOpportunities)
    .values(
      unique.map((r) => ({
        source: r.source,
        externalId: r.externalId,
        title: r.title,
        cpvCode: r.cpvCode,
        cpvDescription: r.cpvDescription,
        contractingAuthority: r.contractingAuthority,
        estimatedValueRon: r.estimatedValueRon !== null ? String(r.estimatedValueRon) : null,
        procedureType: r.procedureType,
        stateText: r.stateText,
        isOpen: r.isOpen,
        publicationDate: r.publicationDate,
        deadlineAt: r.deadlineAt,
        detailUrl: r.detailUrl,
        matchedRuleId: r.matchedRuleId,
        isPriority: r.isPriority,
        raw: r.raw,
        minTurnoverRon: r.minTurnoverRon !== null ? String(r.minTurnoverRon) : null,
        eligibilityNote: r.eligibilityNote,
        // Doar la INSERT — pe UPDATE (`onConflictDoUpdate` mai jos) nu-l atingem, ca să nu
        // suprascriem un „nu mă interesează"/restaurare manuală de-a lui Stefan pe un rând
        // deja existent doar pt. că a picat acum pe o regulă de excludere sau de eligibilitate
        // nouă.
        dismissedAt: r.excludedByRule || r.ineligibleByTurnover ? new Date() : null,
      })),
    )
    .onConflictDoUpdate({
      target: [tenderOpportunities.source, tenderOpportunities.externalId],
      set: {
        title: sql`EXCLUDED.title`,
        cpvCode: sql`EXCLUDED.cpv_code`,
        cpvDescription: sql`EXCLUDED.cpv_description`,
        contractingAuthority: sql`EXCLUDED.contracting_authority`,
        estimatedValueRon: sql`EXCLUDED.estimated_value_ron`,
        procedureType: sql`EXCLUDED.procedure_type`,
        stateText: sql`EXCLUDED.state_text`,
        isOpen: sql`EXCLUDED.is_open`,
        deadlineAt: sql`EXCLUDED.deadline_at`,
        matchedRuleId: sql`EXCLUDED.matched_rule_id`,
        isPriority: sql`EXCLUDED.is_priority`,
        raw: sql`EXCLUDED.raw`,
        // COALESCE: job-ul nu mai re-verifică Secțiunea 3 pt. rândurile deja verificate (limita de
        // trafic SICAP) și trimite null pe ele — null-ul ăla nu trebuie să șteargă valoarea salvată.
        minTurnoverRon: sql`COALESCE(EXCLUDED.min_turnover_ron, ${tenderOpportunities.minTurnoverRon})`,
        eligibilityNote: sql`COALESCE(EXCLUDED.eligibility_note, ${tenderOpportunities.eligibilityNote})`,
        updatedAt: new Date(),
      },
    })
    .returning({
      id: tenderOpportunities.id,
      externalId: tenderOpportunities.externalId,
      title: tenderOpportunities.title,
      isPriority: tenderOpportunities.isPriority,
      detailUrl: tenderOpportunities.detailUrl,
      dismissedAt: tenderOpportunities.dismissedAt,
      inserted: sql<boolean>`(xmax = 0)`,
    })

  const inserted = result.filter((r) => r.inserted).length
  return { inserted, updated: result.length - inserted, rows: result }
}

/**
 * Licitațiile publice dintre `externalIds` care au deja Secțiunea 3 extrasă (prag sau notă) —
 * job-ul nu le mai cere încă o dată de la SICAP.
 */
export async function listEligibilityCheckedNoticeIds(externalIds: string[]): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set()
  const rows = await db
    .select({ externalId: tenderOpportunities.externalId })
    .from(tenderOpportunities)
    .where(
      and(
        eq(tenderOpportunities.source, 'contract_notice'),
        inArray(tenderOpportunities.externalId, externalIds),
        or(isNotNull(tenderOpportunities.minTurnoverRon), isNotNull(tenderOpportunities.eligibilityNote)),
      ),
    )
  return new Set(rows.map((r) => r.externalId))
}

// ── Reguli de urmărire ────────────────────────────────────────────────────

export async function listWatchRules() {
  return db.select().from(tenderWatchRules).where(isNull(tenderWatchRules.deletedAt)).orderBy(asc(tenderWatchRules.createdAt))
}

export async function listActiveWatchRules() {
  return db
    .select()
    .from(tenderWatchRules)
    .where(and(isNull(tenderWatchRules.deletedAt), eq(tenderWatchRules.active, true)))
}

export async function createWatchRule(input: CreateWatchRuleInput) {
  const [row] = await db
    .insert(tenderWatchRules)
    .values({
      label: input.label,
      cpvPrefix: input.cpvPrefix ?? null,
      keyword: input.keyword ?? null,
      active: input.active ?? true,
      highPriority: input.highPriority ?? false,
      exclude: input.exclude ?? false,
    })
    .returning()
  return row
}

export async function updateWatchRule(id: string, input: UpdateWatchRuleInput) {
  const [row] = await db
    .update(tenderWatchRules)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(tenderWatchRules.id, id), isNull(tenderWatchRules.deletedAt)))
    .returning()
  return row
}

export async function deleteWatchRule(id: string) {
  const [row] = await db
    .update(tenderWatchRules)
    .set({ deletedAt: new Date() })
    .where(and(eq(tenderWatchRules.id, id), isNull(tenderWatchRules.deletedAt)))
    .returning()
  return row
}
