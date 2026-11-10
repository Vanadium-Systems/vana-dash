import { and, asc, eq, gt, isNull, or, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { prospectPeople, prospects, prospectViews, prospectViewStars, users } from '../../shared/db/schema/index.js'
import { trFor } from '../../shared/lib/i18n.js'
import type { Locale } from '../../shared/lib/locale.js'
import { notify } from '../../shared/lib/notify.js'
import { loadSessionUser, type SessionUser } from '../../shared/lib/session.js'
import { compileProspectFilters, type ProspectFilter } from './filters.js'
import { filterContext } from './service.js'
import type { CreateViewSchema, UpdateViewSchema } from './views-schema.js'

type Me = Pick<SessionUser, 'id' | 'features'> & { tenant?: SessionUser['tenant'] }
type CreateInput = z.infer<typeof CreateViewSchema>
type UpdateInput = z.infer<typeof UpdateViewSchema>

export interface ProspectView {
  id: string
  name: string
  kind: 'companies' | 'people'
  filters: ProspectFilter[]
  columns: string[]
  sort: { key: string; dir: 'asc' | 'desc' } | null
  calcs: Record<string, string>
  layout: 'list' | 'board' | 'forecast'
  shared: boolean
  notifyNew: boolean
  ownerId: string
  ownerName: string
  isMine: boolean
  starred: boolean
}

function selectViews(me: Me, where: SQL | undefined) {
  return db
    .select({
      id: prospectViews.id,
      name: prospectViews.name,
      kind: prospectViews.kind,
      filters: prospectViews.filters,
      columns: prospectViews.columns,
      sort: prospectViews.sort,
      calcs: prospectViews.calcs,
      layout: prospectViews.layout,
      shared: prospectViews.shared,
      notifyNew: prospectViews.notifyNew,
      ownerId: prospectViews.ownerUserId,
      ownerName: sql<string>`coalesce(nullif(${users.displayName}, ''), ${users.email})`,
      isMine: sql<boolean>`${prospectViews.ownerUserId} = ${me.id}`,
      starred: sql<boolean>`EXISTS (SELECT 1 FROM ${prospectViewStars} s WHERE s."view_id" = ${prospectViews.id} AND s."user_id" = ${me.id} AND s."deleted_at" IS NULL)`,
    })
    .from(prospectViews)
    .innerJoin(users, eq(users.id, prospectViews.ownerUserId))
    .where(and(isNull(prospectViews.deletedAt), where))
    .orderBy(asc(sql`lower(${prospectViews.name})`), prospectViews.id) as unknown as Promise<ProspectView[]>
}

const visibleToMe = (me: Me) => or(eq(prospectViews.ownerUserId, me.id), eq(prospectViews.shared, true))

/** `starred` holds every visible view I starred, mine included, so the sidebar can show them together. */
export async function listViews(me: Me) {
  const rows = await selectViews(me, visibleToMe(me))
  return {
    mine: rows.filter((v) => v.isMine),
    starred: rows.filter((v) => v.starred),
    shared: rows.filter((v) => !v.isMine),
  }
}

async function findView(me: Me, id: string) {
  const [view] = await selectViews(me, and(eq(prospectViews.id, id), visibleToMe(me)))
  return view
}

export async function createView(me: Me, input: CreateInput) {
  // A view created with the alert on must not announce everything that already matches.
  const [row] = await db
    .insert(prospectViews)
    .values({ ...input, ownerUserId: me.id, lastNotifiedAt: input.notifyNew ? new Date() : null })
    .returning({ id: prospectViews.id })
  return findView(me, row!.id)
}

/** Only the owner edits; anyone else gets undefined (404), shared or not. */
export async function updateView(me: Me, id: string, input: UpdateInput) {
  const patch: Partial<typeof prospectViews.$inferInsert> = { ...input, updatedAt: new Date() }
  if (input.notifyNew) {
    const [current] = await db.select({ notifyNew: prospectViews.notifyNew }).from(prospectViews).where(and(eq(prospectViews.id, id), isNull(prospectViews.deletedAt)))
    if (current && !current.notifyNew) patch.lastNotifiedAt = new Date()
  }
  const [row] = await db
    .update(prospectViews)
    .set(patch)
    .where(and(eq(prospectViews.id, id), eq(prospectViews.ownerUserId, me.id), isNull(prospectViews.deletedAt)))
    .returning({ id: prospectViews.id })
  return row ? findView(me, id) : undefined
}

export async function deleteView(me: Me, id: string) {
  const [row] = await db
    .update(prospectViews)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(prospectViews.id, id), eq(prospectViews.ownerUserId, me.id), isNull(prospectViews.deletedAt)))
    .returning({ id: prospectViews.id })
  return Boolean(row)
}

export async function starView(me: Me, id: string) {
  if (!(await findView(me, id))) return false
  // The unique index spans deleted rows too, so a star removed earlier is revived, not duplicated.
  await db
    .insert(prospectViewStars)
    .values({ viewId: id, userId: me.id })
    .onConflictDoUpdate({
      target: [prospectViewStars.tenantId, prospectViewStars.viewId, prospectViewStars.userId],
      set: { deletedAt: null, updatedAt: new Date() },
    })
  return true
}

export async function unstarView(me: Me, id: string) {
  if (!(await findView(me, id))) return false
  await db
    .update(prospectViewStars)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(prospectViewStars.viewId, id), eq(prospectViewStars.userId, me.id), isNull(prospectViewStars.deletedAt)))
  return true
}

/** One company's pass, run as each owner so the count follows what that person may see. */
export async function runViewAlerts(defaultLocale: Locale) {
  const views = await db
    .select()
    .from(prospectViews)
    .where(and(eq(prospectViews.notifyNew, true), isNull(prospectViews.deletedAt)))
    .orderBy(prospectViews.createdAt)
  const owners = new Map<string, SessionUser | null>()
  let notified = 0
  for (const view of views) {
    if (!owners.has(view.ownerUserId)) owners.set(view.ownerUserId, await loadSessionUser(view.ownerUserId))
    const owner = owners.get(view.ownerUserId)
    if (!owner || owner.status !== 'active' || !owner.features.includes('clienti.view')) continue

    // Taken before the count: a prospect arriving meanwhile is counted again tomorrow, never lost.
    const startedAt = new Date()
    const since = view.lastNotifiedAt ?? view.createdAt
    const ctx = await filterContext(owner, view.kind)
    const where = compileProspectFilters(view.filters as ProspectFilter[], ctx)
    // A people view lists contacts, so "new" means a new person; each company still counts once.
    const [{ total } = { total: 0 }] =
      view.kind === 'people'
        ? await db
            .select({ total: sql<number>`count(DISTINCT ${prospects.id})::int` })
            .from(prospectPeople)
            .innerJoin(prospects, eq(prospects.id, prospectPeople.prospectId))
            .where(and(where, isNull(prospectPeople.deletedAt), gt(prospectPeople.createdAt, since)))
        : await db.select({ total: sql<number>`count(*)::int` }).from(prospects).where(and(where, gt(prospects.createdAt, since)))
    if (total > 0) {
      await notify([owner.id], {
        kind: 'clienti.view_new',
        title: trFor(owner.locale ?? defaultLocale, 'push.clienti.viewNew', { count: total, name: view.name }),
        url: `/clients?view=${view.id}`,
        entityType: 'prospect_view',
        entityId: view.id,
      })
      notified++
    }
    await db.update(prospectViews).set({ lastNotifiedAt: startedAt }).where(eq(prospectViews.id, view.id))
  }
  return { notified }
}
