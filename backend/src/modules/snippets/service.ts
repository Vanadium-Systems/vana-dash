import { and, asc, eq, isNull, or } from 'drizzle-orm'
import type { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { textSnippets } from '../../shared/db/schema/index.js'
import type { CreateSnippetSchema, UpdateSnippetSchema } from './schema.js'

type Me = { id: string }

const live = isNull(textSnippets.deletedAt)

/** Mine, plus what colleagues chose to share. */
export async function listSnippets(me: Me) {
  return db
    .select()
    .from(textSnippets)
    .where(and(live, or(eq(textSnippets.ownerUserId, me.id), eq(textSnippets.shared, true))))
    .orderBy(asc(textSnippets.name))
}

export async function createSnippet(me: Me, input: z.infer<typeof CreateSnippetSchema>) {
  const [row] = await db
    .insert(textSnippets)
    .values({ ownerUserId: me.id, name: input.name, body: input.body, shared: input.shared ?? false })
    .returning()
  return row
}

/** Someone else's snippet answers like a missing one: undefined → 404. */
export async function updateSnippet(me: Me, id: string, input: z.infer<typeof UpdateSnippetSchema>) {
  const [row] = await db
    .update(textSnippets)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(textSnippets.id, id), eq(textSnippets.ownerUserId, me.id), live))
    .returning()
  return row
}

export async function deleteSnippet(me: Me, id: string) {
  const [row] = await db
    .update(textSnippets)
    .set({ deletedAt: new Date() })
    .where(and(eq(textSnippets.id, id), eq(textSnippets.ownerUserId, me.id), live))
    .returning({ id: textSnippets.id })
  return row
}
