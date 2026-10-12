import argon2 from 'argon2'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { users } from '../../shared/db/schema/index.js'

// Verificarea credențialelor e identică pentru orice user; ce decide dacă poate intra e
// starea lui (`active`), nu rolul — un coleg cu rol de Sales se loghează exact ca Stefan.

export interface CredentialsUser {
  id: string
  email: string
  displayName: string | null
  sessionVersion: number
  status: 'invited' | 'active' | 'disabled'
}

// Verified when the address has no account, so a miss costs the same argon2 round as a wrong
// password and the response time does not say which addresses exist.
const UNKNOWN_USER_HASH = argon2.hash('no-such-user')

export async function verifyCredentials(email: string, password: string): Promise<CredentialsUser | null> {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      passwordHash: users.passwordHash,
      sessionVersion: users.sessionVersion,
      status: users.status,
    })
    .from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt)))
  if (!user) {
    await argon2.verify(await UNKNOWN_USER_HASH, password).catch(() => false)
    return null
  }
  // Hashul unui om încă invitat e un șir aleator (`invitat:…`), nu un hash argon2 — `verify`
  // aruncă pe el. Răspunsul e tot „nu ai intrat", nu o eroare internă pe o rută publică.
  const valid = await argon2.verify(user.passwordHash, password).catch(() => false)
  if (!valid) return null
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    sessionVersion: user.sessionVersion,
    status: user.status,
  }
}
