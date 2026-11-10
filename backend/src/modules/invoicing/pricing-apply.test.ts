import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { auditLog, billingClients, contractDocuments } from '../../shared/db/schema/index.js'
import { ClientPricingSchema, planPricingApply } from './pricing-apply.js'
import { applyClientPricing, previewClientPricing } from './service.js'

const calc = { platformId: '00000000-0000-4000-8000-000000000001', flux: 'standard' as const, opDesktop: 3, opMobil: 2, puncte: 2, documente: 100, siatd: 0 }

const input = ClientPricingSchema.parse({
  subscriptionPriceEur: 120,
  contractPlan: 'Standard',
  details: { operatoriGestiune: 3, operatoriTeren: '2', puncteLucru: 2, moduleAddon: 'Tratari' },
  calc,
})

describe('planPricingApply', () => {
  const current = { subscriptionPriceEur: '100.00', contractPlan: 'Basic', contractDetails: { operatoriGestiune: '1', note: 'keep' } }

  it('coerces numbers to text and lists only what changed', () => {
    const plan = planPricingApply(current, input, false)
    expect(input.details.operatoriGestiune).toBe('3')
    expect(plan.changes.map((c) => c.field)).toEqual([
      'subscriptionPriceEur',
      'contractPlan',
      'details.moduleAddon',
      'details.operatoriGestiune',
      'details.operatoriTeren',
      'details.puncteLucru',
    ])
    expect(plan.changes[0]).toEqual({ field: 'subscriptionPriceEur', from: '100', to: '120' })
  })

  it('keeps unknown existing keys and stores the calc inputs', () => {
    const plan = planPricingApply(current, input, false)
    expect(plan.contractDetails.note).toBe('keep')
    expect(plan.contractDetails.calc).toEqual(input.calc)
  })

  it('asks for an addendum only with a signed contract and a relevant change', () => {
    expect(planPricingApply(current, input, true).needsAddendum).toBe(true)
    expect(planPricingApply(current, input, false).needsAddendum).toBe(false)
    const same = { subscriptionPriceEur: '120', contractPlan: 'Standard', contractDetails: { ...input.details } }
    const onlyPlan = ClientPricingSchema.parse({ ...input, contractPlan: 'Pro', details: input.details })
    expect(planPricingApply(same, onlyPlan, true).needsAddendum).toBe(false)
    expect(planPricingApply(same, input, true).changes).toEqual([])
  })
})

describe('client pricing apply', () => {
  const clientIds: string[] = []
  afterAll(async () => {
    if (clientIds.length) {
      await db.delete(contractDocuments).where(inArray(contractDocuments.billingClientId, clientIds))
      await db.delete(billingClients).where(inArray(billingClients.id, clientIds))
    }
  })

  async function makeClient(withSignedContract: boolean) {
    const [row] = await db
      .insert(billingClients)
      .values({
        name: 'Pricing Apply QA',
        cif: 'RO99999998',
        address: 'Str. Test 1',
        subscriptionPriceEur: '100',
        contractPlan: 'Basic',
        contractDetails: { operatoriGestiune: '1', custom: 'x' },
      })
      .returning()
    clientIds.push(row!.id)
    if (withSignedContract) {
      await db.insert(contractDocuments).values({ billingClientId: row!.id, docType: 'contract', pdfStoragePath: 'x.pdf', isSigned: true })
    }
    return row!
  }

  it('preview does not write', async () => {
    const client = await makeClient(true)
    const result = await previewClientPricing(client.id, input)
    expect(result?.needsAddendum).toBe(true)
    const [after] = await db.select().from(billingClients).where(eq(billingClients.id, client.id))
    expect(after!.subscriptionPriceEur).toBe('100.00')
    expect(after!.contractPlan).toBe('Basic')
  })

  it('apply writes price, plan, details and calc in one go and audits', async () => {
    const client = await makeClient(false)
    const result = await applyClientPricing(client.id, input)
    expect(result?.needsAddendum).toBe(false)
    const [after] = await db.select().from(billingClients).where(eq(billingClients.id, client.id))
    expect(after!.subscriptionPriceEur).toBe('120.00')
    expect(after!.contractPlan).toBe('Standard')
    expect(after!.contractDetails).toMatchObject({ custom: 'x', operatoriGestiune: '3', puncteLucru: '2', calc })
    const audit = await db.select().from(auditLog).where(eq(auditLog.entityId, client.id))
    expect(audit.some((a) => a.action === 'client.pret.aplicat')).toBe(true)
  })

  it('answers null for an unknown client', async () => {
    expect(await applyClientPricing('00000000-0000-4000-8000-000000000009', input)).toBeNull()
  })
})
