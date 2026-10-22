import { and, asc, eq, getTableColumns, ilike, inArray, isNull, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { createdByUserId, recordAudit, updatedByUserId } from '../../shared/lib/audit.js'
import { prospects, prospectScoringConfig, prospectStatuses, users } from '../../shared/db/schema/index.js'
import * as invoicingService from '../invoicing/service.js'
import { computeScore, type ScoringWeights } from './scoring.js'
import type {
  CreateProspectSchema,
  CreateProspectStatusSchema,
  ListProspectsQuerySchema,
  PromoteProspectSchema,
  UpdateProspectSchema,
  UpdateProspectStatusSchema,
  UpdateScoringConfigSchema,
} from './schema.js'
import { tr } from '../../shared/lib/i18n.js'

type CreateInput = z.infer<typeof CreateProspectSchema>
type UpdateInput = z.infer<typeof UpdateProspectSchema>
type ListQuery = z.infer<typeof ListProspectsQuerySchema>
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

async function assigneeName(userId: string | null): Promise<string | null> {
  if (!userId) return null
  const [row] = await db.select({ displayName: users.displayName, email: users.email }).from(users).where(eq(users.id, userId))
  return row ? (row.displayName ?? row.email) : null
}

// ── Prospects CRUD ────────────────────────────────────────────────────────────

/**
 * Prioritatea (HOT/WARM/NURTURE/SKIP) NU e stocată — derivată din `score` la citire, cu pragurile
 * curente din config (regula #9 CLAUDE.md: agregare/derivare în SQL, dar și motiv concret: dacă
 * Stefan schimbă pragurile, rândurile vechi nu rămân cu o prioritate "înghețată" greșit).
 */
export async function listProspects(query: ListQuery) {
  const config = await getScoringConfig()
  const hot = Number(config.hotThreshold)
  const warm = Number(config.warmThreshold)
  const nurture = Number(config.nurtureThreshold)

  // Postgres nu permite referirea unui alias din SELECT în WHERE (ordinea de evaluare logică) —
  // expresia CASE WHEN e reconstruită de fiecare dată (rawPriorityCase), aliasul `.as('priority')`
  // se folosește DOAR pe lista de SELECT.
  const rawPriorityCase = () => sql<string>`
    CASE
      WHEN ${prospects.score} >= ${hot} THEN 'HOT'
      WHEN ${prospects.score} >= ${warm} THEN 'WARM'
      WHEN ${prospects.score} >= ${nurture} THEN 'NURTURE'
      ELSE 'SKIP'
    END
  `

  const filters = [isNull(prospects.deletedAt)]
  if (query.archived === 'only') filters.push(sql`${prospects.archivedAt} IS NOT NULL`)
  else if (query.archived !== 'all') filters.push(isNull(prospects.archivedAt))
  if (query.status) filters.push(eq(prospects.status, query.status))
  if (query.source) filters.push(eq(prospects.source, query.source))
  if (query.search) {
    const term = `%${query.search}%`
    filters.push(
      sql`(${ilike(prospects.name, term)} OR ${ilike(prospects.cif, term)} OR ${ilike(prospects.phone, term)} OR ${ilike(prospects.email, term)} OR ${ilike(prospects.contactName, term)})`,
    )
  }
  if (query.priority) filters.push(sql`${rawPriorityCase()} = ${query.priority}`)

  return db
    .select({ ...getTableColumns(prospects), priority: rawPriorityCase().as('priority') })
    .from(prospects)
    .where(and(...filters))
    .orderBy(sql`${prospects.score} DESC NULLS LAST`)
}

export async function getProspect(id: string) {
  const [row] = await db
    .select()
    .from(prospects)
    .where(and(eq(prospects.id, id), isNull(prospects.deletedAt)))
  return row
}

export async function createProspect(input: CreateInput) {
  const config = await getScoringConfig()
  const weights = toScoringWeights(config)
  const hasAnyFinancialData = Boolean((input.revenue && input.revenue > 500) || (input.employeeCount && input.employeeCount > 0))

  const score = computeScore(
    {
      revenue: input.revenue ?? null,
      profit: input.profit ?? null,
      debt: input.debt ?? null,
      equity: input.equity ?? null,
      cash: input.cash ?? null,
      receivables: input.receivables ?? null,
      inventory: input.inventory ?? null,
      employeeCount: input.employeeCount ?? null,
      foundingYear: input.foundingYear ?? null,
      hasWebsite: Boolean(input.website),
      hasPhone: Boolean(input.phone),
      hasEmail: Boolean(input.email),
      hasContactName: Boolean(input.contactName),
      hasRecentFinancials: hasAnyFinancialData,
      hasAnyFinancialData,
    },
    weights,
  )

  const [row] = await db
    .insert(prospects)
    .values({
      ...createdByUserId(),
      ...updatedByUserId(),
      name: input.name,
      cif: input.cif,
      phone: input.phone,
      email: input.email,
      website: input.website,
      contactName: input.contactName,
      caenCode: input.caenCode,
      foundingYear: input.foundingYear,
      employeeCount: input.employeeCount,
      revenue: input.revenue !== undefined && input.revenue !== null ? String(input.revenue) : undefined,
      profit: input.profit !== undefined && input.profit !== null ? String(input.profit) : undefined,
      debt: input.debt !== undefined && input.debt !== null ? String(input.debt) : undefined,
      equity: input.equity !== undefined && input.equity !== null ? String(input.equity) : undefined,
      cash: input.cash !== undefined && input.cash !== null ? String(input.cash) : undefined,
      receivables: input.receivables !== undefined && input.receivables !== null ? String(input.receivables) : undefined,
      inventory: input.inventory !== undefined && input.inventory !== null ? String(input.inventory) : undefined,
      score: String(score),
      source: input.source,
      platformId: input.platformId,
    })
    .returning()
  return row
}

function numericOrUndefined(v: number | null | undefined) {
  if (v === undefined) return undefined
  return v === null ? null : String(v)
}

export async function updateProspect(id: string, input: UpdateInput) {
  const existing = await getProspect(id)
  if (!existing) return null

  if (input.status !== undefined) {
    const [activeStatus] = await db
      .select({ id: prospectStatuses.id })
      .from(prospectStatuses)
      .where(and(eq(prospectStatuses.key, input.status), isNull(prospectStatuses.deletedAt)))
    if (!activeStatus) throw new InvalidProspectStatusError(tr('errors.prospects.statusNotInCatalog', { status: input.status }))
  }

  if (input.assignedUserId) {
    const [assignee] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, input.assignedUserId), eq(users.status, 'active'), isNull(users.deletedAt)))
    if (!assignee) throw new InvalidAssigneeError(tr('errors.prospects.assigneeInvalid'))
  }

  const { revenue, profit, debt, equity, cash, receivables, inventory, ...rest } = input

  const merged = {
    revenue: revenue !== undefined ? revenue : existing.revenue !== null ? Number(existing.revenue) : null,
    profit: profit !== undefined ? profit : existing.profit !== null ? Number(existing.profit) : null,
    debt: debt !== undefined ? debt : existing.debt !== null ? Number(existing.debt) : null,
    equity: equity !== undefined ? equity : existing.equity !== null ? Number(existing.equity) : null,
    cash: cash !== undefined ? cash : existing.cash !== null ? Number(existing.cash) : null,
    receivables: receivables !== undefined ? receivables : existing.receivables !== null ? Number(existing.receivables) : null,
    inventory: inventory !== undefined ? inventory : existing.inventory !== null ? Number(existing.inventory) : null,
    employeeCount: rest.employeeCount !== undefined ? rest.employeeCount : existing.employeeCount,
    foundingYear: rest.foundingYear !== undefined ? rest.foundingYear : existing.foundingYear,
    website: rest.website !== undefined ? rest.website : existing.website,
    phone: rest.phone !== undefined ? rest.phone : existing.phone,
    email: rest.email !== undefined ? rest.email : existing.email,
    contactName: rest.contactName !== undefined ? rest.contactName : existing.contactName,
  }

  const config = await getScoringConfig()
  const weights = toScoringWeights(config)
  const hasAnyFinancialData = Boolean((merged.revenue && merged.revenue > 500) || (merged.employeeCount && merged.employeeCount > 0))
  const score = computeScore(
    { ...merged, hasWebsite: Boolean(merged.website), hasPhone: Boolean(merged.phone), hasEmail: Boolean(merged.email), hasContactName: Boolean(merged.contactName), hasRecentFinancials: hasAnyFinancialData, hasAnyFinancialData },
    weights,
  )

  const [row] = await db
    .update(prospects)
    .set({
      ...rest,
      revenue: numericOrUndefined(revenue),
      profit: numericOrUndefined(profit),
      debt: numericOrUndefined(debt),
      equity: numericOrUndefined(equity),
      cash: numericOrUndefined(cash),
      receivables: numericOrUndefined(receivables),
      inventory: numericOrUndefined(inventory),
      score: String(score),
      updatedAt: new Date(),
    })
    .where(eq(prospects.id, id))
    .returning()

  if (input.assignedUserId !== undefined && input.assignedUserId !== existing.assignedUserId) {
    await recordAudit({
      action: 'prospect.responsabil.schimbat',
      entityType: 'prospect',
      entityId: id,
      changes: { responsabil: [await assigneeName(existing.assignedUserId), await assigneeName(input.assignedUserId)] },
    })
  }
  return row
}

export async function deleteProspect(id: string) {
  const [row] = await db
    .update(prospects)
    .set({ deletedAt: new Date() })
    .where(and(eq(prospects.id, id), isNull(prospects.deletedAt)))
    .returning()
  return row
}

export async function archiveProspect(id: string) {
  const [row] = await db
    .update(prospects)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(prospects.id, id), isNull(prospects.deletedAt)))
    .returning()
  return row
}

export async function unarchiveProspect(id: string) {
  const [row] = await db
    .update(prospects)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(and(eq(prospects.id, id), isNull(prospects.deletedAt)))
    .returning()
  return row
}

export async function archiveProspects(ids: string[]) {
  const rows = await db
    .update(prospects)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(inArray(prospects.id, ids), isNull(prospects.deletedAt)))
    .returning()
  return rows
}

export async function unarchiveProspects(ids: string[]) {
  const rows = await db
    .update(prospects)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(and(inArray(prospects.id, ids), isNull(prospects.deletedAt)))
    .returning()
  return rows
}

/**
 * "Promovează la client" — creează un `billing_client` din câmpurile prospectului (reutilizează
 * invoicing.createClient, nu duplicăm logica de creare). Adresa e cerută explicit în UI
 * (billing_clients.address e NOT NULL) — nu punem placeholder fals.
 */
export async function promoteProspect(id: string, input: PromoteInput) {
  const prospect = await getProspect(id)
  if (!prospect) return null

  const cif = input.cif ?? prospect.cif
  if (!cif) throw new Error(tr('errors.prospects.cifMissing'))

  const client = await invoicingService.createClient({
    name: prospect.name,
    cif,
    address: input.address,
    city: input.city,
    county: input.county,
    email: prospect.email ?? undefined,
    platformId: input.platformId ?? prospect.platformId ?? undefined,
    country: 'RO',
  })
  if (!client) throw new Error(tr('errors.prospects.clientNotCreated'))

  const [row] = await db
    .update(prospects)
    .set({ billingClientId: client.id, status: 'aprobat', updatedAt: new Date() })
    .where(eq(prospects.id, id))
    .returning()
  return row
}

/**
 * Marchează un prospect ca dezabonat, pe potrivire exactă (case-insensitive) de email — apelat
 * din modules/email/unsubscribe-service.ts la click pe link-ul de dezabonare, ca pattern
 * identic promoteProspect de mai sus (apel cross-modul explicit, nu import generic). No-op
 * silențios dacă emailul nu se potrivește cu niciun prospect (majoritatea cazurilor — nu orice
 * dezabonat e neapărat în CRM).
 */
export async function markProspectUnsubscribedByEmail(email: string) {
  const [row] = await db
    .update(prospects)
    .set({ status: 'dezabonat', updatedAt: new Date() })
    .where(and(isNull(prospects.deletedAt), ilike(prospects.email, email)))
    .returning()
  return row ?? null
}

/** Recalculează scorul tuturor prospecților cu config-ul curent — apelat după editare ponderi/praguri. */
export async function recalculateAllScores() {
  const config = await getScoringConfig()
  const weights = toScoringWeights(config)
  const rows = await db.select().from(prospects).where(isNull(prospects.deletedAt))

  for (const p of rows) {
    const revenue = p.revenue !== null ? Number(p.revenue) : null
    const employeeCount = p.employeeCount
    const hasAnyFinancialData = Boolean((revenue && revenue > 500) || (employeeCount && employeeCount > 0))
    const score = computeScore(
      {
        revenue,
        profit: p.profit !== null ? Number(p.profit) : null,
        debt: p.debt !== null ? Number(p.debt) : null,
        equity: p.equity !== null ? Number(p.equity) : null,
        cash: p.cash !== null ? Number(p.cash) : null,
        receivables: p.receivables !== null ? Number(p.receivables) : null,
        inventory: p.inventory !== null ? Number(p.inventory) : null,
        employeeCount,
        foundingYear: p.foundingYear,
        hasWebsite: Boolean(p.website),
        hasPhone: Boolean(p.phone),
        hasEmail: Boolean(p.email),
        hasContactName: Boolean(p.contactName),
        hasRecentFinancials: hasAnyFinancialData,
        hasAnyFinancialData,
      },
      weights,
    )
    await db.update(prospects).set({ score: String(score), updatedAt: new Date() }).where(eq(prospects.id, p.id))
  }
  return rows.length
}
