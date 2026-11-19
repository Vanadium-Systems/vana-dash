import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../shared/db/client.js'
import { financialRecords } from '../../shared/db/schema/index.js'
import { oldestUnpaidDueDate } from '../../shared/lib/client-payment-due.js'
import { getCompanyTimeZone } from '../../shared/lib/company.js'
import { paidAmountSql } from '../../shared/lib/payments.js'
import type { PlatformConfig } from '../types.js'

// `vanagreen.billing-state` v1: the whole billing mirror VanaGreen keeps for a tenant, sent by
// PUT /api/v1/platform/tenants/:id/billing-state. VanaGreen holds the same schema
// (recyclers_app shared/lib/billing-state-contract.ts); both are tested against
// ./contract/billing-state.v1/, and scripts/check-vanagreen-contract.sh keeps VanaGreen's copy
// identical. A new field or a new meaning is version 2, never an edit of version 1.

export const BILLING_STATE_CONTRACT = 'vanagreen.billing-state'
export const BILLING_STATE_VERSION = 1

const FETCH_TIMEOUT_MS = 15_000

// A calendar day, checked for real (2026-02-30 is refused), not a moment.
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }, 'not a calendar day')

const timeZone = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: value })
      return true
    } catch {
      return false
    }
  }, 'unknown time zone')

export const billingStateV1Schema = z
  .object({
    contract: z.literal(BILLING_STATE_CONTRACT),
    version: z.literal(BILLING_STATE_VERSION),
    // The company's zone (company profile). Every day below is a day in this zone.
    timeZone,
    // Last day the client pays on time; overdue from the next day.
    paymentDueOn: day,
    // unpaid_invoice: paymentDueOn is the due day of the oldest issued invoice still unpaid.
    // next_invoice: nothing is owed; paymentDueOn is nextInvoiceOn plus the payment terms.
    paymentDueKind: z.enum(['unpaid_invoice', 'next_invoice']),
    // The day the next invoice is issued (billing_clients.billing_due_date here).
    nextInvoiceOn: day,
    cycle: z
      .object({
        period: z.enum(['monthly', 'annual']),
        day: z.number().int().min(1).max(28),
        // Only for annual cycles.
        month: z.number().int().min(1).max(12).nullable(),
      })
      .strict()
      .refine((cycle) => (cycle.period === 'annual') === (cycle.month !== null), 'month is set exactly for annual cycles'),
    // At least one invoice paid. VanaGreen ends a demo / trial on true and never starts one on false.
    paying: z.boolean(),
  })
  .strict()

export type BillingStateV1 = z.infer<typeof billingStateV1Schema>

export interface BillingStateInput {
  timeZone: string
  /** Due day of the oldest issued invoice still unpaid, if any. */
  unpaidDueOn: string | null
  nextInvoiceOn: string
  paymentTermsDays: number
  period: 'monthly' | 'annual'
  cycleDay: number
  cycleMonth: number | null
  paying: boolean
}

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10)
}

/** The document, from what the database says. Pure: the golden fixtures test this. */
export function billingStateFrom(input: BillingStateInput): BillingStateV1 {
  return billingStateV1Schema.parse({
    contract: BILLING_STATE_CONTRACT,
    version: BILLING_STATE_VERSION,
    timeZone: input.timeZone,
    paymentDueOn: input.unpaidDueOn ?? addDays(input.nextInvoiceOn, input.paymentTermsDays),
    paymentDueKind: input.unpaidDueOn ? 'unpaid_invoice' : 'next_invoice',
    nextInvoiceOn: input.nextInvoiceOn,
    cycle: { period: input.period, day: input.cycleDay, month: input.period === 'annual' ? input.cycleMonth : null },
    paying: input.paying,
  })
}

async function hasPaidInvoice(billingClientId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: financialRecords.id })
    .from(financialRecords)
    .where(
      and(
        eq(financialRecords.billingClientId, billingClientId),
        isNull(financialRecords.deletedAt),
        eq(financialRecords.direction, 'out'),
        eq(financialRecords.type, 'invoice'),
        isNotNull(financialRecords.documentNumber),
        isNull(financialRecords.correctsRecordId),
        or(eq(financialRecords.paymentStatus, 'paid'), sql`${paidAmountSql} > 0`),
      ),
    )
    .limit(1)
  return Boolean(row)
}

/** The single place the mirror is built. null when the client has no cycle to describe yet. */
export async function buildBillingState(client: {
  id: string
  billingDueDate: string | null
  paymentTermsDays: number | null
  billingCycle: 'monthly' | 'annual' | null
  billingCycleDay: number | null
  billingCycleMonth: number | null
}): Promise<BillingStateV1 | null> {
  if (!client.billingDueDate || !client.billingCycle || !client.billingCycleDay) return null
  const [unpaidDueOn, paying, zone] = await Promise.all([oldestUnpaidDueDate(client.id), hasPaidInvoice(client.id), getCompanyTimeZone()])
  return billingStateFrom({
    timeZone: zone,
    unpaidDueOn,
    nextInvoiceOn: client.billingDueDate,
    paymentTermsDays: client.paymentTermsDays ?? 0,
    period: client.billingCycle,
    cycleDay: client.billingCycleDay,
    cycleMonth: client.billingCycleMonth,
    paying,
  })
}

/** Key order does not make two states different. */
export function sameBillingState(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b)
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : 1))
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export interface BillingStatePushResult {
  ok: boolean
  status: number
  tenantId: string
  /** VanaGreen does not know this version: nothing is retried, an alert is raised. */
  versionRefused?: boolean
  message?: string
}

/** Never throws (connector failure stays isolated); the caller logs or alerts. */
export async function putVanagreenBillingState(config: PlatformConfig, tenantId: string, state: BillingStateV1): Promise<BillingStatePushResult> {
  try {
    const res = await fetch(`${config.apiUrl}/api/v1/platform/tenants/${tenantId}/billing-state`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, status: res.status, tenantId, versionRefused: res.status === 422, message: text.slice(0, 500) }
    }
    return { ok: true, status: res.status, tenantId }
  } catch (err) {
    return { ok: false, status: 0, tenantId, message: String(err) }
  }
}
