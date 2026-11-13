import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { invoiceSequences } from '../db/schema/index.js'
import { tr } from './i18n.js'

// Alocator de numere de factură — pattern identic cu vanagreen (SELECT ... FOR UPDATE
// într-o tranzacție), simplificat: fără tenant, fără linked sequences.
// Concurența serializează pe row lock: fără goluri, fără duplicate.

// Series that do not start from the invoice defaults (prefix VAN). A proforma has its own series
// so its numbers never collide with, or leave gaps in, the fiscal ones.
const SERIES_DEFAULTS: Record<string, { prefix: string }> = { proforma: { prefix: 'PRO' } }

export const sequenceDefaults = (key: string) => ({ key, ...SERIES_DEFAULTS[key] })

export type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function nextInvoiceNumber(key = 'invoice', tx?: DrizzleTx): Promise<string> {
  if (tx) return allocateWithinTx(tx, key)
  return db.transaction((t) => allocateWithinTx(t, key))
}

async function allocateWithinTx(tx: DrizzleTx, key: string): Promise<string> {
  // Lazy-init: prima emitere creează rândul cu config default (VAN-yyyy-0001).
  await tx.insert(invoiceSequences).values(sequenceDefaults(key)).onConflictDoNothing({ target: [invoiceSequences.tenantId, invoiceSequences.key] })
  const rows = await tx.select().from(invoiceSequences).where(eq(invoiceSequences.key, key)).for('update')
  const row = rows[0]
  if (!row) throw new Error(tr('errors.invoicing.sequenceKeyNotCreated', { key }))

  const year = new Date().getUTCFullYear()
  const { nextValue, lastResetYear } = nextValueOf(row, year)

  await tx
    .update(invoiceSequences)
    .set({ currentValue: nextValue, lastResetYear, updatedAt: new Date() })
    .where(eq(invoiceSequences.id, row.id))

  return formatInvoiceNumber({
    prefix: row.prefix,
    separator: row.separator,
    yearFormat: row.yearFormat,
    padding: row.padding,
    value: nextValue,
    year,
  })
}

type SequenceRow = typeof invoiceSequences.$inferSelect

function nextValueOf(row: SequenceRow, year: number): { nextValue: number; lastResetYear: number | null } {
  if (row.resetOn === 'year' && row.lastResetYear !== year) return { nextValue: row.startFrom, lastResetYear: year }
  // First allocation (also covers resetOn === 'never'): starts from startFrom.
  if (row.currentValue === 0 && row.lastResetYear === null) return { nextValue: row.startFrom, lastResetYear: year }
  return { nextValue: row.currentValue + 1, lastResetYear: row.lastResetYear }
}

/**
 * The number the next issue would get, without allocating it: for the confirmation step. Another
 * issue in between takes it, and the confirmation then names one that is no longer next; the
 * issue itself always allocates under the row lock.
 */
export async function peekNextInvoiceNumber(key = 'invoice'): Promise<{ number: string; defaultPaymentTermsDays: number }> {
  // The defaults of a series live in the column defaults, so a missing row is created the way the first issue would.
  await db.insert(invoiceSequences).values(sequenceDefaults(key)).onConflictDoNothing({ target: [invoiceSequences.tenantId, invoiceSequences.key] })
  const [row] = await db.select().from(invoiceSequences).where(eq(invoiceSequences.key, key))
  if (!row) throw new Error(tr('errors.invoicing.sequenceKeyNotCreated', { key }))
  const year = new Date().getUTCFullYear()
  const { nextValue } = nextValueOf(row, year)
  return {
    number: formatInvoiceNumber({ prefix: row.prefix, separator: row.separator, yearFormat: row.yearFormat, padding: row.padding, value: nextValue, year }),
    defaultPaymentTermsDays: row.defaultPaymentTermsDays,
  }
}

export interface FormatOpts {
  prefix: string
  separator: string
  yearFormat: 'none' | 'yy' | 'yyyy'
  padding: number
  value: number
  year: number
}

export function formatInvoiceNumber(opts: FormatOpts): string {
  const parts: string[] = []
  if (opts.prefix !== '') parts.push(opts.prefix)
  if (opts.yearFormat === 'yyyy') parts.push(String(opts.year))
  else if (opts.yearFormat === 'yy') parts.push(String(opts.year % 100).padStart(2, '0'))
  parts.push(opts.padding > 0 ? String(opts.value).padStart(opts.padding, '0') : String(opts.value))
  return parts.join(opts.separator)
}
