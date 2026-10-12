/**
 * QA — test dedicat: retrimiterea ACELUIAȘI batch (mai mulți destinatari, nu un
 * singur rând) de 2 ori la rând. `service.test.ts` (BE) acoperă deja dedup pe UN
 * singur destinatar repetat — testul de aici verifică explicit că, la un batch de 3
 * destinatari toți reușiți, a doua rulare identică sare peste TOȚI 3, nu doar peste
 * unul, și că sendEmailWithResult nu mai e chemat deloc a doua oară.
 */
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import { emailSends, emailTemplates } from '../../shared/db/schema/index.js'
import type { SendEmailResult } from '../../shared/lib/email.js'

import { effectiveFeatures } from '../../shared/lib/session.js'
import type { SessionUser } from '../../shared/lib/session.js'
// Admin de test: toate cutiile (mailboxes null) și toate funcționalitățile. Se folosește doar
// ca omul din sesiune; conținutul rămâne subiectul testului.
const admin = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'stefan@vanadium.systems',
  displayName: 'Stefan',
  role: { id: '00000000-0000-4000-8000-000000000002', name: 'Admin', kind: 'admin' },
  isPlatformAdmin: true,
  features: effectiveFeatures([], 'admin'),
  mailboxes: null,
  status: 'active',
  lastSeenAt: null,
  notificationPrefs: null,
  navLayout: null,
  updatesSeenAt: null,
  sessionVersion: 1,
} satisfies SessionUser


const sendEmailWithResultMock =
  vi.fn<(opts: { to: string; subject: string; text: string; from?: string }) => Promise<SendEmailResult>>()

vi.mock('../../shared/lib/email.js', () => ({
  sendEmailWithResult: sendEmailWithResultMock,
}))

const { bulkSend } = await import('./service.js')

let templateId: string

beforeAll(async () => {
  const [tpl] = await db
    .insert(emailTemplates)
    .values({ name: 'QA batch-dedup 2x', subject: 'Salut {{nume}}', body: 'Bună {{nume}}.' })
    .returning()
  templateId = tpl!.id
})

afterEach(() => {
  sendEmailWithResultMock.mockReset()
})

afterAll(async () => {
  await db.delete(emailSends).where(eq(emailSends.templateId, templateId))
  await db.delete(emailTemplates).where(eq(emailTemplates.id, templateId))
})

describe('bulkSend — batch întreg (3 destinatari) retrimis identic de 2 ori la rând', () => {
  it('a doua rulare sare peste toți cei 3, zero apeluri noi de trimitere', async () => {
    sendEmailWithResultMock.mockResolvedValue({ ok: true })
    const recipients = [
      { email: 'batch2x-a@example.com', nume: 'Ana' },
      { email: 'batch2x-b@example.com', nume: 'Ion' },
      { email: 'batch2x-c@example.com' },
    ]

    const first = await bulkSend(admin, { templateId, recipients, from: 'contact' })
    expect(first.sent).toBe(3)
    expect(first.skipped).toBe(0)
    expect(sendEmailWithResultMock).toHaveBeenCalledTimes(3)

    sendEmailWithResultMock.mockClear()

    const second = await bulkSend(admin, { templateId, recipients, from: 'contact' })
    expect(second.sent).toBe(0)
    expect(second.skipped).toBe(3)
    expect(second.failed).toBe(0)
    expect(second.results).toHaveLength(0)
    expect(sendEmailWithResultMock).not.toHaveBeenCalled()
  })
})
