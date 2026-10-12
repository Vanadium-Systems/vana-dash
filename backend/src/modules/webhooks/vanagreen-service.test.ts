/**
 * handleVanagreenAlert — dedup pe (tenant, factură, sursă) + conținutul mesajului/emailBody.
 * Auth/graniță rutei are propriile teste în vanagreen-routes.test.ts.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { alertRules, alerts } from '../../shared/db/schema/index.js'
import { handleVanagreenAlert } from './vanagreen-service.js'

const ruleIds: string[] = []

afterAll(async () => {
  if (ruleIds.length) {
    await db.delete(alerts).where(inArray(alerts.ruleId, ruleIds))
    await db.delete(alertRules).where(inArray(alertRules.id, ruleIds))
  }
})

async function ruleFor(tenantId: string, invoiceId: string, source: string) {
  const [rule] = await db
    .select()
    .from(alertRules)
    .where(eq(alertRules.metricKey, `vanagreen.efactura.${tenantId}.${invoiceId}.${source}`))
  if (rule) ruleIds.push(rule.id)
  return rule
}

describe('handleVanagreenAlert', () => {
  it('creează o regulă + o alertă cu mesaj și emailBody bogat pt. o respingere ANAF', async () => {
    const tenantId = `qa-tenant-${Date.now()}`
    const invoiceId = `qa-invoice-${Date.now()}`
    await handleVanagreenAlert({
      source: 'anaf_rejected',
      tenant_id: tenantId,
      tenant_name: 'Acme Recycling SRL',
      invoice_id: invoiceId,
      invoice_number: 'FV-2026-0042',
      company_name: 'Client Test SRL',
      company_cui: 'RO12345678',
      error_code: null,
      error_message: 'BR-CO-15: valoarea totală nu corespunde sumei liniilor',
      url: 'https://recycle.vanadium.systems/contabilitate?invoice=abc',
    })

    const rule = await ruleFor(tenantId, invoiceId, 'anaf_rejected')
    expect(rule).toBeDefined()
    expect(rule!.name).toContain('Acme Recycling SRL')

    const [alert] = await db.select().from(alerts).where(eq(alerts.ruleId, rule!.id))
    expect(alert!.message).toContain('ANAF a respins factura')
    expect(alert!.message).toContain('FV-2026-0042')
    expect(alert!.message).toContain('BR-CO-15')
  })

  it('folosește "ciornă" ca referință factură când invoice_number e null', async () => {
    const tenantId = `qa-tenant-${Date.now()}-b`
    const invoiceId = `qa-invoice-${Date.now()}-b`
    await handleVanagreenAlert({
      source: 'send_error',
      tenant_id: tenantId,
      tenant_name: 'Test Tenant',
      invoice_id: invoiceId,
      invoice_number: null,
      company_name: null,
      company_cui: null,
      error_code: 'EFACTURA_UPLOAD_FAILED',
      error_message: 'S3Error: The specified bucket does not exist',
      url: 'https://recycle.vanadium.systems/contabilitate',
    })

    const rule = await ruleFor(tenantId, invoiceId, 'send_error')
    const [alert] = await db.select().from(alerts).where(eq(alerts.ruleId, rule!.id))
    expect(alert!.message).toContain('Eroare tehnică la trimitere')
    expect(alert!.message).toContain('ciornă')
  })

  it('dedup: nu creează o a doua alertă cât timp cea veche e neconfirmată', async () => {
    const tenantId = `qa-tenant-${Date.now()}-c`
    const invoiceId = `qa-invoice-${Date.now()}-c`
    const payload = {
      source: 'anaf_rejected' as const,
      tenant_id: tenantId,
      tenant_name: 'Dedup Test',
      invoice_id: invoiceId,
      invoice_number: 'FV-1',
      company_name: null,
      company_cui: null,
      error_code: null,
      error_message: 'prima încercare',
      url: 'https://recycle.vanadium.systems',
    }
    await handleVanagreenAlert(payload)
    await handleVanagreenAlert({ ...payload, error_message: 'a doua încercare, mesaj ușor diferit' })

    const rule = await ruleFor(tenantId, invoiceId, 'anaf_rejected')
    const rows = await db
      .select()
      .from(alerts)
      .where(and(eq(alerts.ruleId, rule!.id), isNull(alerts.acknowledgedAt)))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.message).toContain('prima încercare')
  })
})
