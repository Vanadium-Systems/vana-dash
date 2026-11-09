import { and, desc, eq, gt, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { notes } from '../../shared/db/schema/index.js'
import { tr } from '../../shared/lib/i18n.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { foldDiacritics, foldedIlike } from '../../shared/lib/text.js'
import { TiptapDocError, plainToTiptapDoc, sanitizeTiptapDoc, tiptapToText, type TiptapNode } from '../../shared/lib/tiptap-text.js'
import type { CreateNoteSchema, ListNotesQuerySchema, UpdateNoteSchema } from './schema.js'
import { recordVersion } from './versions.js'

type CreateNoteInput = z.infer<typeof CreateNoteSchema>
type UpdateNoteInput = z.infer<typeof UpdateNoteSchema>
type ListNotesQuery = z.infer<typeof ListNotesQuerySchema>

export type Note = typeof notes.$inferSelect

// Notițele sunt ale fiecărui om (PLAN.md C2) — filtrul pe owner e aici, nu într-un hook
// comun, ca să fie vizibil lângă fiecare interogare.

export const TRASH_DAYS = 30

export class NoteNotFoundError extends Error {
  constructor() {
    super(tr('errors.notes.notFound'))
  }
}

export class NoteInputError extends Error {
  constructor(
    readonly code: 'EMPTY_NOTE' | 'INVALID_BODY',
    message: string,
  ) {
    super(message)
  }
}

export class NoteChangedError extends Error {
  constructor(readonly current: Note) {
    super(tr('errors.notes.changed'))
  }
}

const own = (me: SessionUser) => eq(notes.ownerUserId, me.id)
const inTrash = () => and(isNotNull(notes.deletedAt), gt(notes.deletedAt, sql`now() - make_interval(days => ${TRASH_DAYS})`))

export async function listNotes(me: SessionUser, query: Partial<ListNotesQuery> & { search?: string }) {
  const filters: (SQL | undefined)[] = [own(me)]
  const view = query.view ?? 'active'
  if (view === 'trash') filters.push(inTrash())
  else filters.push(isNull(notes.deletedAt), view === 'archived' ? isNotNull(notes.archivedAt) : isNull(notes.archivedAt))
  if (query.pinned !== undefined) filters.push(eq(notes.pinned, query.pinned))
  if (query.color !== undefined) filters.push(eq(notes.color, query.color))
  if (query.label) filters.push(sql`${notes.labels} @> ARRAY[${query.label}]::text[]`)
  const term = query.q ?? query.search
  if (term) filters.push(or(foldedIlike(notes.title, term), foldedIlike(notes.body, term)))

  return db
    .select()
    .from(notes)
    .where(and(...filters))
    .orderBy(...(view === 'trash' ? [desc(notes.deletedAt)] : [desc(notes.pinned), desc(notes.updatedAt)]))
}

export async function listPinnedNotes(me: SessionUser, limit: number) {
  return db
    .select()
    .from(notes)
    .where(and(isNull(notes.deletedAt), isNull(notes.archivedAt), own(me), eq(notes.pinned, true)))
    .orderBy(desc(notes.updatedAt))
    .limit(limit)
}

/** A note opened by URL, including one in the Trash (read-only on the client). */
export async function getNote(me: SessionUser, id: string): Promise<Note> {
  const [row] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), own(me), or(isNull(notes.deletedAt), inTrash())))
  if (!row) throw new NoteNotFoundError()
  return row
}

/** Fails with 404 unless the note is the person's and not in the Trash. */
async function requireLiveNote(me: SessionUser, id: string): Promise<Note> {
  const [row] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, id), own(me), isNull(notes.deletedAt)))
  if (!row) throw new NoteNotFoundError()
  return row
}

function cleanDoc(raw: unknown): TiptapNode {
  try {
    return sanitizeTiptapDoc(raw)
  } catch (err) {
    if (err instanceof TiptapDocError) throw new NoteInputError('INVALID_BODY', tr('errors.notes.invalidBody'))
    throw err
  }
}

function normalizeLabels(labels: string[]): string[] {
  return [...new Set(labels.map((l) => l.trim()).filter(Boolean))]
}

export async function createNote(me: SessionUser, input: CreateNoteInput) {
  const title = input.title?.trim() ?? ''
  const doc = input.bodyJson !== undefined && input.bodyJson !== null ? cleanDoc(input.bodyJson) : null
  const body = doc ? tiptapToText(doc) : (input.body ?? '')
  if (!title && !body.trim()) throw new NoteInputError('EMPTY_NOTE', tr('errors.notes.empty'))
  const [row] = await db
    .insert(notes)
    .values({
      ownerUserId: me.id,
      title,
      body,
      bodyFormat: doc ? 'rich' : 'plain',
      bodyJson: doc,
      color: input.color ?? null,
      labels: normalizeLabels(input.labels ?? []),
      pinned: input.pinned ?? false,
    })
    .returning()
  return row
}

/**
 * Content (title, body) and metadata (pin, color, labels) are saved by the same route, but only
 * a content change moves `updated_at` ("Editată la 14:32", the order in the grid) and only a
 * content change is checked against `expectedUpdatedAt`: pinning in one tab must not turn the
 * other tab's next keystroke into a conflict.
 */
export async function updateNote(me: SessionUser, id: string, input: UpdateNoteInput) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(notes)
      .where(and(eq(notes.id, id), own(me), isNull(notes.deletedAt)))
      .for('update')
    if (!current) throw new NoteNotFoundError()

    const patch: Partial<typeof notes.$inferInsert> = {}
    if (input.pinned !== undefined) patch.pinned = input.pinned
    if (input.color !== undefined) patch.color = input.color
    if (input.labels !== undefined) patch.labels = normalizeLabels(input.labels)

    const touchesContent = input.title !== undefined || input.body !== undefined || input.bodyJson !== undefined
    if (touchesContent) {
      if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== current.updatedAt.getTime()) {
        throw new NoteChangedError(current)
      }
      if (input.title !== undefined) patch.title = input.title
      if (input.bodyJson !== undefined && input.bodyJson !== null) {
        const doc = cleanDoc(input.bodyJson)
        patch.bodyJson = doc
        patch.body = tiptapToText(doc)
        patch.bodyFormat = 'rich'
      } else if (input.body !== undefined) {
        // Plain text into a rich note (the assistant) becomes paragraphs, so the note stays rich.
        if (current.bodyFormat === 'rich') {
          const doc = plainToTiptapDoc(input.body)
          patch.bodyJson = doc
          patch.body = tiptapToText(doc)
        } else {
          patch.body = input.body
        }
      }
      const changed = (patch.title ?? current.title) !== current.title || (patch.body ?? current.body) !== current.body ||
        JSON.stringify(patch.bodyJson ?? current.bodyJson) !== JSON.stringify(current.bodyJson)
      if (changed) {
        await recordVersion(tx, current)
        patch.updatedAt = new Date()
      }
    }
    if (Object.keys(patch).length === 0) return current
    const [row] = await tx.update(notes).set(patch).where(eq(notes.id, id)).returning()
    return row!
  })
}

export async function setArchived(me: SessionUser, id: string, archived: boolean) {
  await requireLiveNote(me, id)
  const [row] = await db
    .update(notes)
    .set({ archivedAt: archived ? new Date() : null })
    .where(and(eq(notes.id, id), own(me)))
    .returning()
  return row
}

export async function deleteNote(me: SessionUser, id: string) {
  const [row] = await db
    .update(notes)
    .set({ deletedAt: new Date() })
    .where(and(eq(notes.id, id), isNull(notes.deletedAt), own(me)))
    .returning()
  return row
}

export async function restoreNote(me: SessionUser, id: string) {
  const [row] = await db
    .update(notes)
    .set({ deletedAt: null })
    .where(and(eq(notes.id, id), own(me), inTrash()))
    .returning()
  if (!row) throw new NoteNotFoundError()
  return row
}

/** Permanent: the person's whole Trash (versions go with the notes, ON DELETE CASCADE). */
export async function emptyTrash(me: SessionUser) {
  const rows = await db
    .delete(notes)
    .where(and(own(me), isNotNull(notes.deletedAt)))
    .returning({ id: notes.id })
  return { deleted: rows.length }
}

/** Notes past their 30 days in the Trash, everyone's, for jobs/trash-purge.ts. */
export async function purgeExpiredNotes(limit: number): Promise<number> {
  const rows = await db.execute(sql`
    DELETE FROM notes WHERE id IN (
      SELECT id FROM notes
       WHERE deleted_at IS NOT NULL AND deleted_at < now() - make_interval(days => ${TRASH_DAYS})
       ORDER BY deleted_at LIMIT ${limit}
    ) RETURNING id
  `)
  return rows.length
}

// ── Labels ──────────────────────────────────────────────────────────────

export async function listLabels(me: SessionUser) {
  const rows = await db.execute<{ name: string; count: number }>(sql`
    SELECT l AS name, COUNT(*)::int AS count
      FROM notes n, unnest(n.labels) AS l
     WHERE n.owner_user_id = ${me.id} AND n.deleted_at IS NULL
     GROUP BY l ORDER BY l
  `)
  return rows
}

/** Renames (or, with `newName` null, removes) a label on every note of the person, at once. */
export async function changeLabel(me: SessionUser, name: string, newName: string | null) {
  const target = newName?.trim() ?? null
  const rows = await db.execute(sql`
    UPDATE notes
       SET labels = ${
         target
           ? sql`ARRAY(SELECT DISTINCT x FROM unnest(array_replace(labels, ${name}, ${target})) AS x ORDER BY x)`
           : sql`array_remove(labels, ${name})`
       }
     WHERE owner_user_id = ${me.id} AND labels @> ARRAY[${name}]::text[]
    RETURNING id
  `)
  return { updated: rows.length }
}

// ── Bulk ────────────────────────────────────────────────────────────────

export type BulkAction = 'archive' | 'unarchive' | 'delete' | 'restore' | 'pin' | 'unpin' | 'color' | 'addLabel' | 'removeLabel'

/** All of the ids must be the person's (and, for restore, in the Trash), or nothing changes. */
export async function bulkUpdate(me: SessionUser, ids: string[], action: BulkAction, value?: string | number | null) {
  const unique = [...new Set(ids)]
  const scope = action === 'restore' ? inTrash() : isNull(notes.deletedAt)
  return db.transaction(async (tx) => {
    const found = await tx
      .select({ id: notes.id })
      .from(notes)
      .where(and(own(me), scope, sql`${notes.id} IN (${sql.join(unique.map((id) => sql`${id}::uuid`), sql`, `)})`))
      .for('update')
    if (found.length !== unique.length) throw new NoteNotFoundError()

    const label = typeof value === 'string' ? value.trim() : ''
    const set: Record<BulkAction, Partial<typeof notes.$inferInsert> | SQL> = {
      archive: { archivedAt: new Date() },
      unarchive: { archivedAt: null },
      delete: { deletedAt: new Date() },
      restore: { deletedAt: null },
      pin: { pinned: true },
      unpin: { pinned: false },
      color: { color: typeof value === 'number' ? value : null },
      addLabel: sql`labels = CASE WHEN labels @> ARRAY[${label}]::text[] THEN labels ELSE array_append(labels, ${label}) END`,
      removeLabel: sql`labels = array_remove(labels, ${label})`,
    }
    if ((action === 'addLabel' || action === 'removeLabel') && !label) throw new NoteInputError('INVALID_BODY', tr('errors.notes.labelNotFound'))
    const change = set[action]
    const where = sql`id IN (${sql.join(unique.map((id) => sql`${id}::uuid`), sql`, `)}) AND owner_user_id = ${me.id}`
    if ('getSQL' in change) await tx.execute(sql`UPDATE notes SET ${change} WHERE ${where}`)
    else await tx.update(notes).set(change).where(where)
    return { updated: unique.length }
  })
}

/** Ctrl K: the person's own live notes, with the part of the body around the match. */
export async function searchOwnNotes(me: SessionUser, term: string, limit: number) {
  const rows = await db
    .select({ id: notes.id, title: notes.title, body: notes.body })
    .from(notes)
    .where(and(own(me), isNull(notes.deletedAt), isNull(notes.archivedAt), or(foldedIlike(notes.title, term), foldedIlike(notes.body, term))))
    .orderBy(desc(notes.updatedAt))
    .limit(limit)
  const needle = foldDiacritics(term)
  return rows.map((r) => {
    const at = foldDiacritics(r.body).indexOf(needle)
    const start = Math.max(0, at - 40)
    const snippet = at < 0 ? r.body.slice(0, 80) : `${start > 0 ? '…' : ''}${r.body.slice(start, at + needle.length + 60)}`
    return { id: r.id, title: r.title, snippet: snippet.replace(/\s+/g, ' ').trim() }
  })
}
