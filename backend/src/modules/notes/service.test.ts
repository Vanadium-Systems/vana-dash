import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { notes, roles, users } from '../../shared/db/schema/index.js'
import { loadSessionUser } from '../../shared/lib/session.js'
import { listNotes } from './service.js'

const [owner] = await db.select({ id: users.id }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(roles.kind, 'admin')).limit(1)
const me = (await loadSessionUser(owner!.id))!

// The same word in every spelling a Romanian keyboard or an old document produces.
const titles = ['Ședință cu Acme', 'ŞEDINŢĂ trimestrială', 'şedinţă scurtă', 'Întâlnire']
const ids: string[] = []
for (const title of titles) {
  const [row] = await db.insert(notes).values({ ownerUserId: me.id, title }).returning({ id: notes.id })
  ids.push(row!.id)
}

afterAll(async () => {
  for (const id of ids) await db.delete(notes).where(eq(notes.id, id))
})

describe('notes search', () => {
  it('ignores diacritics, in the comma and the cedilla forms', async () => {
    const found = (await listNotes(me, { search: 'sedinta' })).filter((n) => ids.includes(n.id)).map((n) => n.title)
    expect(found.sort()).toEqual(titles.slice(0, 3).sort())
  })

  it('finds a plain word when the search has diacritics', async () => {
    const found = (await listNotes(me, { search: 'întâlnire' })).filter((n) => ids.includes(n.id)).map((n) => n.title)
    expect(found).toEqual(['Întâlnire'])
  })
})
