import '../load-env.js'
import argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import { db, sql } from './client.js'
import { roles, users } from './schema/index.js'

// Creează (sau actualizează parola pentru) singurul user: Stefan, și rolurile de bază.
// Credențialele vin din env — niciodată hard-codate.
const email = process.env.ADMIN_EMAIL
const password = process.env.ADMIN_PASSWORD
if (!email || !password) throw new Error('Missing ADMIN_EMAIL / ADMIN_PASSWORD')
if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters')

const passwordHash = await argon2.hash(password)
const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email))

let userId: string
if (existing) {
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, existing.id))
  userId = existing.id
  console.log(`User ${email} updated.`)
} else {
  const [created] = await db.insert(users).values({ email, passwordHash, displayName: process.env.ADMIN_NAME ?? 'Admin' }).returning()
  if (!created) throw new Error('Insert user nu a returnat nimic')
  userId = created.id
  console.log(`User ${email} created.`)
}

// Rolurile seed (PLAN.md C2): Admin primește tot ce are firma, deci nu are listă de
// funcționalități; Manager pornește gol — adminul îi dă ce are nevoie. Idempotent: seed-ul
// poate să re ruleze fără să piardă funcționalitățile setate între timp.
async function ensureRole(name: string, kind: 'admin' | 'manager') {
  const [found] = await db.select().from(roles).where(eq(roles.name, name))
  if (found) return found.id
  const [created] = await db.insert(roles).values({ name, kind, features: [], createdByUserId: userId }).returning()
  if (!created) throw new Error(`Insert rol ${name} nu a returnat nimic`)
  return created.id
}

const adminRoleId = await ensureRole('Admin', 'admin')
await ensureRole('Manager', 'manager')

// Stefan e admin + is_platform_admin (singurul cont cu acces la firmele-client, din Etapa 3).
// Cutii de email: niciun rând în user_mailboxes — adminul are toate implicit.
await db
  .update(users)
  .set({ roleId: adminRoleId, isPlatformAdmin: true, status: 'active', updatedAt: new Date() })
  .where(eq(users.id, userId))

console.log(`Roles seeded; ${email} is Admin + platform admin.`)
await sql.end()
