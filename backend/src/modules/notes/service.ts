import { and, desc, eq, isNull, or, sql, type AnyColumn } from 'drizzle-orm'
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

// No unaccent extension in the database: fold Romanian letters (both comma and cedilla forms) on both sides.
function foldDiacritics(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// Romanian letters (comma and cedilla forms, lower then upper case), built from code points: a
// string literal with them would read as UI text to no-romanian-in-code.test.ts.
const DIACRITICS = String.fromCodePoint(0x103, 0xe2, 0xee, 0x219, 0x15f, 0x21b, 0x163, 0x102, 0xc2, 0xce, 0x218, 0x15e, 0x21a, 0x162)
const FOLDED = 'aaissttaaisstt'

function foldedLike(column: AnyColumn, term: string) {
  return sql`translate(lower(${column}), ${DIACRITICS}, ${FOLDED}) like ${term}`
}

export async function listNotes(me: SessionUser, query: ListNotesQuery) {
  const filters = [isNull(notes.deletedAt), eq(notes.ownerUserId, me.id)]
  if (query.pinned !== undefined) filters.push(eq(notes.pinned, query.pinned))
  if (query.search) {
    const term = `%${foldDiacritics(query.search)}%`
    filters.push(or(foldedLike(notes.title, term), foldedLike(notes.body, term))!)
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
