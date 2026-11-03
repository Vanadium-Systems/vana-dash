import { and, eq, inArray, isNull } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { notes } from '../../shared/db/schema/index.js'
import { excerpt, registerRefType } from '../../shared/lib/entity-refs.js'

// A note is its owner's alone: colleagues get the sender's snapshot and never a way in.
registerRefType('note', {
  kind: 'personal',
  async snapshot(refId, sender) {
    const [row] = await db
      .select({ title: notes.title, body: notes.body })
      .from(notes)
      .where(and(eq(notes.id, refId), eq(notes.ownerUserId, sender.id), isNull(notes.deletedAt)))
    return row ? { card: { title: row.title, excerpt: excerpt(row.body, 300) } } : null
  },
  async resolve(refIds, reader) {
    const rows = await db
      .select({ id: notes.id })
      .from(notes)
      .where(and(inArray(notes.id, refIds), eq(notes.ownerUserId, reader.id), isNull(notes.deletedAt)))
    const own = new Set(rows.map((r) => r.id))
    return new Map(refIds.map((id) => [id, { canOpen: own.has(id) }]))
  },
})
