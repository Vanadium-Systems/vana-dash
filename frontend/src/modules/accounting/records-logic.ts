import { companyTimeZone } from '@/shared/lib/format'
import type { PaymentStatus } from '@/shared/lib/types'

const DAY_MS = 86_400_000

/** The company-zone calendar day of an instant, as yyyy-mm-dd. */
export function companyDay(value: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: companyTimeZone() }).format(new Date(value))
}

/** Whole days between two yyyy-mm-dd days (b minus a). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS)
}

/** Days past the due date, in the company's zone; 0 when not yet due. */
export function daysOverdue(dueAt: string | null, today: string = companyDay(new Date())): number {
  if (!dueAt) return 0
  return Math.max(0, daysBetween(companyDay(dueAt), today))
}

export function statusFor(remaining: number, amount: number): PaymentStatus {
  if (remaining <= 0) return 'paid'
  return remaining >= amount ? 'unpaid' : 'partial'
}

/**
 * What a payment of `typed` does to the document: the state and the rest it leaves.
 * The server stays the judge; this only previews the effect before the button is pressed.
 */
export function paymentConsequence(args: { amount: number; remaining: number; typed: number }): { next: PaymentStatus; rest: number } | null {
  const { amount, remaining, typed } = args
  if (!Number.isFinite(typed) || typed <= 0) return null
  const rest = Math.max(0, Math.round((remaining - typed) * 100) / 100)
  return { next: statusFor(rest, amount), rest }
}

/** A payment can be recorded on anything but a draft, while something is left to pay. */
export function canRecordPayment(row: { isDraft: boolean; remaining: number }): boolean {
  return !row.isDraft && row.remaining > 0
}
