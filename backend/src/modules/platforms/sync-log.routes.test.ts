/**
 * GET /api/platforms/:id/sync-log: the raw text of a failed sync stays in sync_log and the log;
 * the answer has only errorCode. A marker value in the column proves it.
 */
import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { platforms, roles, syncLog, users } from '../../shared/db/schema/index.js'
import { encryptField } from '../../shared/lib/crypto.js'
import { listSyncLog } from './service.js'
import { sessionToken } from '../../shared/testing/session-token.js'

const MARKER = `RAW-MARKER-${randomUUID()}`

const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))

const app = await buildServer()
await app.ready()

const [person] = await db
  .insert(users)
  .values({
    email: `qa-sync-log-${Date.now()}@example.com`,
    passwordHash: await argon2.hash('acme-test-password'),
    displayName: 'QA sync log',
    roleId: adminRole!.id,
  })
  .returning()
const cookies = { vana_session: await sessionToken(app, person!.id, person!.sessionVersion) }

const [platform] = await db
  .insert(platforms)
  .values({ name: 'QA sync log', type: 'nu-exista-un-asa-connector', apiUrl: 'http://127.0.0.1:1', apiKeyEnc: await encryptField('fake-key') })
  .returning()
await db.insert(syncLog).values([
  { platformId: platform!.id, status: 'FAILED', errorMessage: `TimeoutError: The operation was aborted due to timeout ${MARKER}`, startedAt: new Date('2020-03-01T10:00:00Z') },
  { platformId: platform!.id, status: 'SUCCESS', recordsSync: 3, startedAt: new Date('2020-03-01T09:00:00Z') },
])

afterAll(async () => {
  await db.delete(syncLog).where(eq(syncLog.platformId, platform!.id))
  await db.delete(platforms).where(eq(platforms.id, platform!.id))
  await db.delete(users).where(eq(users.id, person!.id))
  await app.close()
})

describe('sync log of a platform', () => {
  it('GET /api/platforms/:id/sync-log answers with errorCode and no raw text', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/platforms/${platform!.id}/sync-log`, cookies })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.body).not.toContain(MARKER)
    const [failed, succeeded] = res.json().data
    expect(failed).toMatchObject({ status: 'FAILED', errorCode: 'SYNC_TIMEOUT' })
    expect(failed).not.toHaveProperty('errorMessage')
    expect(succeeded).toMatchObject({ status: 'SUCCESS', errorCode: null })
  })

  it('listSyncLog, which the assistant tool uses too, has no raw text', async () => {
    expect(JSON.stringify(await listSyncLog(platform!.id))).not.toContain(MARKER)
  })
})
