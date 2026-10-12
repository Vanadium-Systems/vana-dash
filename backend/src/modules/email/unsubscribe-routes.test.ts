/**
 * GET /api/email/unsubscribe/:token — rută publică, fără sesiune. Verifică doar GRANIȚA rutei
 * (token invalid/valid, idempotență); logica de suprimare are propriile teste în
 * unsubscribe-service.test.ts.
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { config } from '../../shared/config.js'
import { db } from '../../shared/db/client.js'
import { emailSuppressions } from '../../shared/db/schema/index.js'
import { buildUnsubscribeToken } from './unsubscribe-token.js'

const app = await buildServer()
await app.ready()
afterAll(async () => app.close())

const suppressionEmails: string[] = []
afterAll(async () => {
  if (suppressionEmails.length) await db.delete(emailSuppressions).where(inArray(emailSuppressions.email, suppressionEmails))
})

describe('GET /api/email/unsubscribe/:token', () => {
  it('returns 400 with an HTML error page for a malformed token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/email/unsubscribe/not-a-real-token' })
    expect(res.statusCode).toBe(400)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('invalid')
  })

  it('returns 400 when EMAIL_UNSUBSCRIBE_SECRET is not configured (fail-closed)', async () => {
    const original = config.emailUnsubscribeSecret
    config.emailUnsubscribeSecret = 'temp-secret-for-token-build'
    const token = buildUnsubscribeToken('route-noconfig@example.com')!
    config.emailUnsubscribeSecret = ''
    try {
      const res = await app.inject({ method: 'GET', url: `/api/email/unsubscribe/${token}` })
      expect(res.statusCode).toBe(400)
    } finally {
      config.emailUnsubscribeSecret = original
    }
  })

  it('accepts a valid token, suppresses the email, and returns a confirmation page (200)', async () => {
    const original = config.emailUnsubscribeSecret
    config.emailUnsubscribeSecret = 'temp-secret-for-token-build'
    const email = 'route-valid@example.com'
    suppressionEmails.push(email)
    const token = buildUnsubscribeToken(email)!
    try {
      const res = await app.inject({ method: 'GET', url: `/api/email/unsubscribe/${token}` })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('text/html')
      expect(res.body).toContain(email)

      const [row] = await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, email))
      expect(row).toBeDefined()
    } finally {
      config.emailUnsubscribeSecret = original
    }
  })

  it('is idempotent — clicking the same link twice still returns 200', async () => {
    const original = config.emailUnsubscribeSecret
    config.emailUnsubscribeSecret = 'temp-secret-for-token-build'
    const email = 'route-twice@example.com'
    suppressionEmails.push(email)
    const token = buildUnsubscribeToken(email)!
    try {
      const first = await app.inject({ method: 'GET', url: `/api/email/unsubscribe/${token}` })
      const second = await app.inject({ method: 'GET', url: `/api/email/unsubscribe/${token}` })
      expect(first.statusCode).toBe(200)
      expect(second.statusCode).toBe(200)

      const rows = await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, email))
      expect(rows).toHaveLength(1)
    } finally {
      config.emailUnsubscribeSecret = original
    }
  })
})

// RFC 8058 one-click — chip-ul nativ "Unsubscribe" din Gmail face POST direct pe același URL
// din header-ul List-Unsubscribe, fără să deschidă vreun tab. Nu randează răspunsul, deci nu
// verificăm body, doar statusul + efectul (suprimarea chiar are loc).
describe('POST /api/email/unsubscribe/:token (one-click, RFC 8058)', () => {
  it('returns 400 for a malformed token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/email/unsubscribe/not-a-real-token' })
    expect(res.statusCode).toBe(400)
  })

  it('accepts a valid token and suppresses the email with a bare 200 (no page body needed)', async () => {
    const original = config.emailUnsubscribeSecret
    config.emailUnsubscribeSecret = 'temp-secret-for-token-build'
    const email = 'route-oneclick@example.com'
    suppressionEmails.push(email)
    const token = buildUnsubscribeToken(email)!
    try {
      const res = await app.inject({ method: 'POST', url: `/api/email/unsubscribe/${token}` })
      expect(res.statusCode).toBe(200)

      const [row] = await db.select().from(emailSuppressions).where(eq(emailSuppressions.email, email))
      expect(row).toBeDefined()
    } finally {
      config.emailUnsubscribeSecret = original
    }
  })
})
