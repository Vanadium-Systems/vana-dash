import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client.js'
import { roles, users } from '../db/schema/index.js'
import type { SessionUser } from '../lib/session.js'

// Useri de test pentru modulele cu spații per om (Arhivă, Calendar): un rând real în `users`
// plus obiectul `SessionUser` pe care serviciile îl primesc. `features` se dă explicit, ca
// testele să nu depindă de rol și de momentul în care seed-ul a rulat. Rândurile create se
// curăță din lista `cleanup`, pe care testul o golește în `afterAll`.

export interface TestUserOptions {
  features?: string[]
  roleKind?: 'admin' | 'manager' | 'custom'
}

export async function createTestUser(label: string, cleanup: string[], options: TestUserOptions = {}) {
  const email = `qa-${label}-${crypto.randomUUID()}@test.local`
  const [row] = await db
    .insert(users)
    .values({ email, passwordHash: 'x', displayName: `QA ${label}` })
    .returning()
  const userId = row!.id
  cleanup.push(userId)

  let role: SessionUser['role'] = null
  if (options.roleKind) {
    // `!` — INSERT...RETURNING nu întoarce zero rânduri aici, dar convenția din tot backend-ul
    // (`const [row] = ...`) tipează rezultatul ca posibil undefined.
    const [created] = await db
      .insert(roles)
      .values({ name: `QA rol ${options.roleKind} ${crypto.randomUUID()}`, kind: options.roleKind, features: [] })
      .returning()
    const createdRole = created!
    cleanup.push(createdRole.id)
    await db.update(users).set({ roleId: createdRole.id }).where(eq(users.id, userId))
    role = { id: createdRole.id, name: createdRole.name, kind: createdRole.kind }
  }

  const me: SessionUser = {
    id: userId,
    email,
    displayName: row!.displayName,
    role,
    isPlatformAdmin: false,
    features: options.features ?? [],
    mailboxes: [],
    status: 'active',
    lastSeenAt: null,
    notificationPrefs: null,
    navLayout: null,
    updatesSeenAt: null,
    sessionVersion: 1,
  }
  return me
}

/** Șterge userii și rolurile create de `createTestUser` (rolurile cad odată cu userii). */
export async function cleanupTestUsers(ids: string[]) {
  if (ids.length === 0) return
  await db.delete(users).where(inArray(users.id, ids))
}