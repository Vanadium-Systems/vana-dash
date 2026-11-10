import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { prospectListFolders, prospectListMembers, prospectLists, prospects, users } from '../../shared/db/schema/index.js'
import { visibleProspectsWhere } from '../../shared/lib/prospect-access.js'
import type { SessionUser } from '../../shared/lib/session.js'
import type { AddMembersInput, CreateFolderSchema, CreateListSchema, UpdateFolderSchema, UpdateListSchema } from './lists-schema.js'
import { prospectWhere } from './service.js'

type Me = Pick<SessionUser, 'id' | 'features'> & { tenant?: SessionUser['tenant'] }

const ownerName = sql<string>`coalesce(nullif(${users.displayName}, ''), ${users.email})`

// ── Folders ──────────────────────────────────────────────────────────────────
const folderVisible = (me: Me) => or(eq(prospectListFolders.ownerUserId, me.id), eq(prospectListFolders.shared, true))
const listVisible = (me: Me) => or(eq(prospectLists.ownerUserId, me.id), eq(prospectLists.shared, true))

export async function listFolders(me: Me) {
  return db
    .select({
      id: prospectListFolders.id,
      name: prospectListFolders.name,
      shared: prospectListFolders.shared,
      ownerId: prospectListFolders.ownerUserId,
      ownerName,
      isMine: sql<boolean>`${prospectListFolders.ownerUserId} = ${me.id}`,
    })
    .from(prospectListFolders)
    .innerJoin(users, eq(users.id, prospectListFolders.ownerUserId))
    .where(and(isNull(prospectListFolders.deletedAt), folderVisible(me)))
    .orderBy(asc(sql`lower(${prospectListFolders.name})`), prospectListFolders.id)
}

export async function createFolder(me: Me, input: z.infer<typeof CreateFolderSchema>) {
  const [row] = await db.insert(prospectListFolders).values({ ...input, ownerUserId: me.id }).returning({ id: prospectListFolders.id })
  return (await listFolders(me)).find((f) => f.id === row!.id)!
}

export async function updateFolder(me: Me, id: string, input: z.infer<typeof UpdateFolderSchema>) {
  const [row] = await db
    .update(prospectListFolders)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(prospectListFolders.id, id), eq(prospectListFolders.ownerUserId, me.id), isNull(prospectListFolders.deletedAt)))
    .returning({ id: prospectListFolders.id })
  return row ? (await listFolders(me)).find((f) => f.id === id) : undefined
}

/** The folder is soft-deleted, so the FK's `set null` never fires: the lists are detached here. */
export async function deleteFolder(me: Me, id: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(prospectListFolders)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(prospectListFolders.id, id), eq(prospectListFolders.ownerUserId, me.id), isNull(prospectListFolders.deletedAt)))
      .returning({ id: prospectListFolders.id })
    if (!row) return false
    await tx.update(prospectLists).set({ folderId: null, updatedAt: new Date() }).where(eq(prospectLists.folderId, id))
    return true
  })
}

// ── Lists ────────────────────────────────────────────────────────────────────
export class FolderNotFoundError extends Error {}

async function assertFolderUsable(me: Me, folderId: string | null | undefined) {
  if (!folderId) return
  const [row] = await db
    .select({ id: prospectListFolders.id })
    .from(prospectListFolders)
    .where(and(eq(prospectListFolders.id, folderId), isNull(prospectListFolders.deletedAt), folderVisible(me)))
  if (!row) throw new FolderNotFoundError()
}

/** Members are counted as I see them: someone else's private prospect does not inflate the number. */
export async function listLists(me: Me) {
  const rows = await db.execute<{
    id: string
    name: string
    folder_id: string | null
    shared: boolean
    owner_id: string
    owner_name: string
    is_mine: boolean
    member_count: number
  }>(sql`
    SELECT l.id, l.name, l.folder_id, l.shared, l.owner_user_id AS owner_id,
           coalesce(nullif(u.display_name, ''), u.email) AS owner_name,
           l.owner_user_id = ${me.id} AS is_mine,
           (SELECT count(*)::int FROM ${prospectListMembers} m JOIN ${prospects} ON ${prospects.id} = m.prospect_id
             WHERE m.list_id = l.id AND m.deleted_at IS NULL AND ${prospects.deletedAt} IS NULL AND ${visibleProspectsWhere(me)}) AS member_count
      FROM ${prospectLists} l JOIN ${users} u ON u.id = l.owner_user_id
     WHERE l.deleted_at IS NULL AND (l.owner_user_id = ${me.id} OR l.shared)
     ORDER BY lower(l.name), l.id`)
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    folderId: r.folder_id,
    shared: r.shared,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    isMine: r.is_mine,
    memberCount: r.member_count,
  }))
}

export async function createList(me: Me, input: z.infer<typeof CreateListSchema>) {
  await assertFolderUsable(me, input.folderId)
  const [row] = await db
    .insert(prospectLists)
    .values({ name: input.name, folderId: input.folderId ?? null, shared: input.shared, ownerUserId: me.id })
    .returning({ id: prospectLists.id })
  return (await listLists(me)).find((l) => l.id === row!.id)!
}

export async function updateList(me: Me, id: string, input: z.infer<typeof UpdateListSchema>) {
  await assertFolderUsable(me, input.folderId)
  const [row] = await db
    .update(prospectLists)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(prospectLists.id, id), eq(prospectLists.ownerUserId, me.id), isNull(prospectLists.deletedAt)))
    .returning({ id: prospectLists.id })
  return row ? (await listLists(me)).find((l) => l.id === id) : undefined
}

/** Members go with the list: the `list` filter would otherwise keep matching a deleted one. */
export async function deleteList(me: Me, id: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(prospectLists)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(prospectLists.id, id), eq(prospectLists.ownerUserId, me.id), isNull(prospectLists.deletedAt)))
      .returning({ id: prospectLists.id })
    if (!row) return false
    await tx.delete(prospectListMembers).where(eq(prospectListMembers.listId, id))
    return true
  })
}

/** The owner, or anyone when the list is shared; otherwise it does not exist for me. */
async function findUsableList(me: Me, id: string) {
  const [list] = await db
    .select({ id: prospectLists.id, folderId: prospectLists.folderId })
    .from(prospectLists)
    .where(and(eq(prospectLists.id, id), isNull(prospectLists.deletedAt), listVisible(me)))
  return list
}

export interface AddMembersResult {
  added: number
  skipped: { alreadyIn: number; inFolderLists: number; withoutPhone: number; doNotContact: number; notVisible: number }
}

export async function addMembers(me: Me, listId: string, input: AddMembersInput): Promise<AddMembersResult | undefined> {
  const list = await findUsableList(me, listId)
  if (!list) return undefined

  const byIds = 'ids' in input
  const ids = byIds ? [...new Set(input.ids)] : []
  const rules = byIds ? {} : (input.rules ?? {})
  const candidates = byIds
    ? sql`SELECT ${prospects.id} AS id FROM ${prospects}
           WHERE ${inArray(prospects.id, ids)} AND ${prospects.deletedAt} IS NULL AND ${visibleProspectsWhere(me)}`
    : sql`SELECT ${prospects.id} AS id FROM ${prospects}
           WHERE ${await prospectWhere(me, { f: input.f, q: input.q })}
           ORDER BY ${prospects.score} DESC NULLS LAST, ${prospects.id} LIMIT ${input.limit ?? 5000}`

  // One reason per candidate, in this order, so the counts add up to the candidates.
  const result = await db.execute<{ added: number; total: number; already_in: number; in_folder: number; no_phone: number; dnc: number }>(sql`
    WITH cand AS (${candidates}),
    flags AS (
      SELECT c.id,
        EXISTS (SELECT 1 FROM ${prospectListMembers} m WHERE m.list_id = ${listId} AND m.prospect_id = c.id AND m.deleted_at IS NULL) AS already_in,
        ${
          list.folderId
            ? sql`EXISTS (SELECT 1 FROM ${prospectListMembers} m JOIN ${prospectLists} l ON l.id = m.list_id
                           WHERE m.prospect_id = c.id AND m.deleted_at IS NULL AND l.deleted_at IS NULL
                             AND l.folder_id = ${list.folderId} AND l.id <> ${listId})`
            : sql`false`
        } AS in_folder,
        NOT EXISTS (SELECT 1 FROM prospect_contact_points cp
                     WHERE cp.prospect_id = c.id AND cp.kind = 'phone' AND cp.status <> 'invalid' AND cp.deleted_at IS NULL) AS no_phone,
        -- every contact person is "do not contact"; a prospect without people is not skipped
        (EXISTS (SELECT 1 FROM prospect_people pp WHERE pp.prospect_id = c.id AND pp.deleted_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM prospect_people pp WHERE pp.prospect_id = c.id AND pp.deleted_at IS NULL AND NOT pp.do_not_contact)) AS dnc
      FROM cand c
    ), decided AS (
      SELECT id,
        CASE
          WHEN already_in THEN 'already_in'
          WHEN ${rules.skipInFolderLists ?? false}::boolean AND in_folder THEN 'in_folder'
          WHEN ${rules.skipWithoutPhone ?? false}::boolean AND no_phone THEN 'no_phone'
          WHEN ${rules.skipDoNotContact ?? false}::boolean AND dnc THEN 'dnc'
        END AS reason
      FROM flags
    ), ins AS (
      INSERT INTO ${prospectListMembers} (list_id, prospect_id, added_by_user_id)
      SELECT ${listId}, id, ${me.id} FROM decided WHERE reason IS NULL
      ON CONFLICT DO NOTHING
      RETURNING 1
    )
    SELECT (SELECT count(*)::int FROM ins) AS added,
           (SELECT count(*)::int FROM decided) AS total,
           count(*) FILTER (WHERE reason = 'already_in')::int AS already_in,
           count(*) FILTER (WHERE reason = 'in_folder')::int AS in_folder,
           count(*) FILTER (WHERE reason = 'no_phone')::int AS no_phone,
           count(*) FILTER (WHERE reason = 'dnc')::int AS dnc
      FROM decided`)
  const row = result[0]!
  return {
    added: row.added,
    skipped: {
      alreadyIn: row.already_in,
      inFolderLists: row.in_folder,
      withoutPhone: row.no_phone,
      doNotContact: row.dnc,
      // Ids that are missing, deleted or not mine all look the same from here, on purpose.
      notVisible: byIds ? ids.length - row.total : 0,
    },
  }
}

export async function removeMembers(me: Me, listId: string, ids: string[]) {
  if (!(await findUsableList(me, listId))) return undefined
  const removed = await db
    .delete(prospectListMembers)
    .where(and(eq(prospectListMembers.listId, listId), inArray(prospectListMembers.prospectId, ids)))
    .returning({ id: prospectListMembers.id })
  return { removed: removed.length }
}
