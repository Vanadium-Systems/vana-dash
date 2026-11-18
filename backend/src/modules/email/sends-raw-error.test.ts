/**
 * The raw failure text of a send stays in email_sends.error_message and the log. Every route that
 * shows a send answers with errorCode and nothing of the text. A marker value in the column proves it.
 */
import { randomUUID } from 'node:crypto'
import argon2 from 'argon2'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { db } from '../../shared/db/client.js'
import { emailSends, roles, users } from '../../shared/db/schema/index.js'
import { sessionToken } from '../../shared/testing/session-token.js'

const MARKER = `RAW-MARKER-${randomUUID()}`
const RAW_TEXT = `Error: Resend a răspuns cu HTTP 429: ${MARKER}`
const WINDOW = 'from=2020-03-01T00:00:00.000Z&to=2020-03-02T00:00:00.000Z'

const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))

const app = await buildServer()
await app.ready()

const email = `qa-sends-raw-${Date.now()}@example.com`
const [person] = await db
  .insert(users)
  .values({ email, passwordHash: await argon2.hash('acme-test-password'), displayName: 'QA sends', roleId: adminRole!.id })
  .returning()
const cookies = { vana_session: await sessionToken(app, person!.id, person!.sessionVersion) }

const batchId = randomUUID()
const sendIds: string[] = []
const [failedSend] = await db
  .insert(emailSends)
  .values({
    recipient: 'raw-error@example.com',
    subject: 'Acme failed send',
    status: 'failed',
    errorMessage: RAW_TEXT,
    batchId,
    sentByUserId: person!.id,
    createdAt: new Date('2020-03-01T10:00:00Z'),
  })
  .returning()
sendIds.push(failedSend!.id)

afterAll(async () => {
  await db.delete(emailSends).where(inArray(emailSends.id, sendIds))
  await db.delete(users).where(eq(users.id, person!.id))
  await app.close()
})

describe('routes that show a send never carry the raw failure text', () => {
  it('GET /api/email/sends: errorCode instead of errorMessage', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/email/sends?${WINDOW}&status=failed&batchId=${batchId}`, cookies })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.body).not.toContain(MARKER)
    const [item] = res.json().data.items
    expect(item.errorCode).toBe('EMAIL_SEND_RATE_LIMITED')
    expect(item).not.toHaveProperty('errorMessage')
  })

  it('GET /api/email/sends/report', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/email/sends/report?${WINDOW}`, cookies })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.body).not.toContain(MARKER)
    expect(res.json().data.totals.failed).toBeGreaterThanOrEqual(1)
  })

  it('GET /api/email/sends/export: the CSV has the code, not the text', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/email/sends/export?${WINDOW}&status=failed`, cookies })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.body).not.toContain(MARKER)
    expect(res.body.split('\n')[0]).toContain('cod_eroare')
    expect(res.body).toContain('EMAIL_SEND_RATE_LIMITED')
  })

  it('GET /api/email/sends/recent-batches', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/email/sends/recent-batches?limit=20', cookies })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.body).not.toContain(MARKER)
  })

  it('GET /api/email/sends/:id/status: errorCode instead of error', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/email/sends/${failedSend!.id}/status`, cookies })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.body).not.toContain(MARKER)
    expect(res.json().data).toMatchObject({ status: 'failed', errorCode: 'EMAIL_SEND_RATE_LIMITED' })
    expect(res.json().data).not.toHaveProperty('error')
  })

  it('a row without a failure has errorCode null', async () => {
    const [ok] = await db
      .insert(emailSends)
      .values({ recipient: 'fine@example.com', subject: 'Acme fine send', status: 'delivered', batchId, createdAt: new Date('2020-03-01T11:00:00Z') })
      .returning()
    sendIds.push(ok!.id)
    const res = await app.inject({ method: 'GET', url: `/api/email/sends?${WINDOW}&status=delivered&batchId=${batchId}`, cookies })
    expect(res.json().data.items[0].errorCode).toBeNull()
  })
})
