import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema/index.js'
import { startSession } from '../lib/sessions.js'
import { getOwnerTenantId, runAsTenant, withRlsBypass } from '../lib/tenancy.js'

/** An access token backed by a real session row, as login issues: the API refuses one without. */
export async function sessionToken(app: FastifyInstance, userId: string, sessionVersion = 1): Promise<string> {
  const [user] = await withRlsBypass(() => db.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, userId)))
  const { sessionId } = await runAsTenant(user?.tenantId ?? getOwnerTenantId(), () => startSession(userId, sessionVersion, { ip: '127.0.0.1' }))
  return app.jwt.sign({ sub: userId, sv: sessionVersion, sid: sessionId })
}
