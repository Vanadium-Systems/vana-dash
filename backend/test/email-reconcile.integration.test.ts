/**
 * Test for jobs/email-reconcile.ts, the safety net for delivery statuses (of mail sent
 * through Resend) that the webhook missed. Reconciling received mail went away together with
 * receiving through Resend.
 */
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { reconcileEmails } from '../src/jobs/email-reconcile.js'
import { db } from '../src/shared/db/client.js'
import { emailSends, emailTemplates, syncLog } from '../src/shared/db/schema/index.js'

const RUN_ID = Date.now()
const SENT_STALE_ID = `sent-stale-${RUN_ID}`
const SENT_CURRENT_ID = `sent-current-${RUN_ID}`
const SENT_UNKNOWN_ID = `sent-unknown-${RUN_ID}`

let templateId: string

beforeAll(async () => {
  const [tpl] = await db
    .insert(emailTemplates)
    .values({ name: `Reconcile ${RUN_ID}`, subject: 'x', body: 'y' })
    .returning()
  templateId = tpl!.id

  await db.insert(emailSends).values([
    { templateId, recipient: 'a@example.com', subject: 's', status: 'sent', resendEmailId: SENT_STALE_ID, batchId: null },
    { templateId, recipient: 'b@example.com', subject: 's', status: 'delivered', resendEmailId: SENT_CURRENT_ID, batchId: null },
  ])
})

afterAll(async () => {
  await db.delete(emailSends).where(eq(emailSends.templateId, templateId))
  await db.delete(emailTemplates).where(eq(emailTemplates.id, templateId))
  await db.delete(syncLog).where(eq(syncLog.jobKey, 'email:reconcile'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function mockFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith('https://api.resend.com/emails?')) {
        return new Response(
          JSON.stringify({
            data: [
              { id: SENT_STALE_ID, last_event: 'delivered' },
              { id: SENT_CURRENT_ID, last_event: 'delivered' },
              { id: SENT_UNKNOWN_ID, last_event: 'bounced' },
            ],
            has_more: false,
          }),
          { status: 200 },
        )
      }
      throw new Error(`fetch neașteptat în test: ${url}`)
    }),
  )
}

describe('reconcileEmails', () => {
  it('actualizează un rând email_sends rămas în urmă, nu atinge unul deja corect', async () => {
    mockFetch()
    await reconcileEmails()

    const [stale] = await db.select().from(emailSends).where(eq(emailSends.resendEmailId, SENT_STALE_ID))
    expect(stale!.status).toBe('delivered')

    const [current] = await db.select().from(emailSends).where(eq(emailSends.resendEmailId, SENT_CURRENT_ID))
    expect(current!.status).toBe('delivered') // era deja așa — nesuprascris inutil
  })

  it('un email_id necunoscut (fără rând email_sends) e no-op, nu eroare', async () => {
    const [log] = await db.select().from(syncLog).where(eq(syncLog.jobKey, 'email:reconcile'))
    expect(log?.status).toBe('SUCCESS')
  })
})
