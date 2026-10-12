/**
 * modules/email/organize-service.ts#labelAllowsNotifications — verificarea la ingest, chiar
 * înainte de notifyPush('email', ...) (inbound-service.ts). Integration test, pg real
 * (test/setup.ts).
 */
import { inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { emailLabels } from '../../shared/db/schema/index.js'
import { createLabel, labelAllowsNotifications } from './organize-service.js'

const labelIds: string[] = []

afterAll(async () => {
  if (labelIds.length) await db.delete(emailLabels).where(inArray(emailLabels.id, labelIds))
})

describe('labelAllowsNotifications', () => {
  it('true dacă labelId e null (mesaj neetichetat — comportament neschimbat)', async () => {
    expect(await labelAllowsNotifications(null)).toBe(true)
  })

  it('true dacă labelId nu corespunde niciunui label existent', async () => {
    expect(await labelAllowsNotifications('00000000-0000-0000-0000-000000000000')).toBe(true)
  })

  it('true implicit la creare (comportament vechi, fără regresie pt. etichetele existente)', async () => {
    const label = await createLabel({ name: `QA Label Default ${Date.now()}`, notificationsEnabled: true })
    labelIds.push(label!.id)
    expect(await labelAllowsNotifications(label!.id)).toBe(true)
  })

  it('false dacă labelul are notificationsEnabled=false (2026-08-20, rapoarte DMARC)', async () => {
    const label = await createLabel({ name: `QA Label DMARC ${Date.now()}`, notificationsEnabled: false })
    labelIds.push(label!.id)
    expect(await labelAllowsNotifications(label!.id)).toBe(false)
  })
})
