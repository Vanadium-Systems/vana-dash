import { and, desc, eq, ilike, isNull, or } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { notes } from '../../shared/db/schema/index.js'
import type { SessionUser } from '../../shared/lib/session.js'
import type { CreateNoteSchema, ListNotesQuerySchema, UpdateNoteSchema } from './schema.js'
import type { z } from 'zod'

type CreateNoteInput = z.infer<typeof CreateNoteSchema>
type UpdateNoteInput = z.infer<typeof UpdateNoteSchema>
type ListNotesQuery = z.infer<typeof ListNotesQuerySchema>

// Notițele sunt ale fiecărui om (PLAN.md C2) — filtrul pe owner e aici, nu într-un hook
// comun, ca să fie vizibil lângă fiecare interogare.

export async function listNotes(me: SessionUser, query: ListNotesQuery) {
  const filters = [isNull(notes.deletedAt), eq(notes.ownerUserId, me.id)]
  if (query.pinned !== undefined) filters.push(eq(notes.pinned, query.pinned))
  if (query.search) {
    const term = `%${query.search}%`
    filters.push(or(ilike(notes.title, term), ilike(notes.body, term))!)
  }

  return db
    .select()
    .from(notes)
    .where(and(...filters))
    .orderBy(desc(notes.pinned), desc(notes.updatedAt))
}

export async function listPinnedNotes(me: SessionUser, limit: number) {
  return db
    .select()
    .from(notes)
    .where(and(isNull(notes.deletedAt), eq(notes.ownerUserId, me.id), eq(notes.pinned, true)))
    .orderBy(desc(notes.updatedAt))
    .limit(limit)
}

export async function createNote(me: SessionUser, input: CreateNoteInput) {
  const [row] = await db
    .insert(notes)
    .values({ ownerUserId: me.id, title: input.title, body: input.body ?? '' })
    .returning()
  return row
}

export async function updateNote(me: SessionUser, id: string, input: UpdateNoteInput) {
  const [row] = await db
    .update(notes)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(notes.id, id), isNull(notes.deletedAt), eq(notes.ownerUserId, me.id)))
    .returning()
  return row
}

export async function deleteNote(me: SessionUser, id: string) {
  const [row] = await db
    .update(notes)
    .set({ deletedAt: new Date() })
    .where(and(eq(notes.id, id), isNull(notes.deletedAt), eq(notes.ownerUserId, me.id)))
    .returning()
  return row
}
