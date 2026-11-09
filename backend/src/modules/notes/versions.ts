import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { noteVersions, notes } from '../../shared/db/schema/index.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { NoteNotFoundError, type Note } from './service.js'

// A version is the note as it was before a save. Continuous saving would write one per pause in
// typing, so a new one is kept only when the last is older than 10 minutes; 50 per note.
const MIN_GAP_MINUTES = 10
const KEEP = 50

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function recordVersion(tx: Tx, note: Note, force = false) {
  if (!force) {
    const [last] = await tx
      .select({ createdAt: noteVersions.createdAt })
      .from(noteVersions)
      .where(eq(noteVersions.noteId, note.id))
      .orderBy(desc(noteVersions.createdAt))
      .limit(1)
    if (last && Date.now() - last.createdAt.getTime() < MIN_GAP_MINUTES * 60_000) return
  }
  await tx.insert(noteVersions).values({ noteId: note.id, title: note.title, body: note.body, bodyJson: note.bodyJson })
  await tx.execute(sql`
    DELETE FROM note_versions WHERE note_id = ${note.id} AND id NOT IN (
      SELECT id FROM note_versions WHERE note_id = ${note.id} ORDER BY created_at DESC LIMIT ${KEEP}
    )
  `)
}

async function requireOwnNote(me: SessionUser, noteId: string): Promise<Note> {
  const [row] = await db
    .select()
    .from(notes)
    .where(and(eq(notes.id, noteId), eq(notes.ownerUserId, me.id)))
  if (!row) throw new NoteNotFoundError()
  return row
}

export async function listVersions(me: SessionUser, noteId: string) {
  await requireOwnNote(me, noteId)
  const rows = await db
    .select({ id: noteVersions.id, createdAt: noteVersions.createdAt, title: noteVersions.title, body: noteVersions.body })
    .from(noteVersions)
    .where(eq(noteVersions.noteId, noteId))
    .orderBy(desc(noteVersions.createdAt))
  return rows.map(({ body, ...v }) => ({ ...v, excerpt: body.slice(0, 160) }))
}

export async function getVersion(me: SessionUser, noteId: string, versionId: string) {
  await requireOwnNote(me, noteId)
  const [row] = await db
    .select()
    .from(noteVersions)
    .where(and(eq(noteVersions.id, versionId), eq(noteVersions.noteId, noteId)))
  if (!row) throw new NoteNotFoundError()
  return row
}

/** The current state is kept as a version first, so a restore can itself be undone. */
export async function restoreVersion(me: SessionUser, noteId: string, versionId: string) {
  const version = await getVersion(me, noteId, versionId)
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(notes)
      .where(and(eq(notes.id, noteId), eq(notes.ownerUserId, me.id), sql`${notes.deletedAt} IS NULL`))
      .for('update')
    if (!current) throw new NoteNotFoundError()
    await recordVersion(tx, current, true)
    const [row] = await tx
      .update(notes)
      .set({
        title: version.title,
        body: version.body,
        bodyJson: version.bodyJson,
        bodyFormat: version.bodyJson ? 'rich' : current.bodyFormat,
        updatedAt: new Date(),
      })
      .where(eq(notes.id, noteId))
      .returning()
    return row!
  })
}
