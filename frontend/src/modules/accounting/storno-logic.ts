import { parseRoDecimal } from '@/shared/lib/utils'

export interface StornoSourceLine {
  id: string
  quantity: number
  unitPrice: number
  vatRate: number
}

export type QuantityCheck = { state: 'empty' } | { state: 'ok'; value: number } | { state: 'invalid' } | { state: 'exceeds'; max: number }

/** An empty box means "leave this line out"; anything else must be above 0 and at most what was invoiced. */
export function checkStornoQuantity(input: string, invoiced: number): QuantityCheck {
  if (!input.trim()) return { state: 'empty' }
  const value = parseRoDecimal(input)
  if (!Number.isFinite(value) || value <= 0) return { state: 'invalid' }
  // Quantities carry up to 3 decimals on the invoice; the epsilon keeps 1,1 vs 1.1 float noise out.
  if (value - invoiced > 1e-9) return { state: 'exceeds', max: invoiced }
  return { state: 'ok', value }
}

/**
 * Gross amount of a partial storno in cents, line by line: net rounded to a cent, then its VAT rounded.
 * A preview for the sentence above the button; the server computes the real document.
 */
export function partialStornoCents(lines: StornoSourceLine[], picked: Record<string, number>): number {
  let total = 0
  for (const line of lines) {
    const quantity = picked[line.id]
    if (!quantity) continue
    const net = Math.round(quantity * line.unitPrice * 100)
    total += net + Math.round((net * line.vatRate) / 100)
  }
  return total
}

/** What a full storno reverses: the invoice minus what earlier credit notes already took, in cents. */
export function fullStornoCents(invoiceAmount: number, corrections: Array<{ amount: number }>): number {
  const reversed = corrections.reduce((sum, doc) => sum + Math.round(Math.abs(doc.amount) * 100), 0)
  return Math.max(0, Math.round(invoiceAmount * 100) - reversed)
}

/** Fully reversed once the credit notes cover the invoice; before that the original reads "partly". */
export function isFullyStornoed(invoiceAmount: number, corrections: Array<{ amount: number }>): boolean {
  return corrections.length > 0 && fullStornoCents(invoiceAmount, corrections) === 0
}
