import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { invoiceSequences } from '../db/schema/index.js'
import { tr } from './i18n.js'

// Alocator de numere de factură — pattern identic cu vanagreen (SELECT ... FOR UPDATE
// într-o tranzacție), simplificat: fără tenant, fără linked sequences.
// Concurența serializează pe row lock: fără goluri, fără duplicate.

export type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function nextInvoiceNumber(key = 'invoice', tx?: DrizzleTx): Promise<string> {
  if (tx) return allocateWithinTx(tx, key)
  return db.transaction((t) => allocateWithinTx(t, key))
}

async function allocateWithinTx(tx: DrizzleTx, key: string): Promise<string> {
  // Lazy-init: prima emitere creează rândul cu config default (VAN-yyyy-0001).
  await tx.insert(invoiceSequences).values({ key }).onConflictDoNothing({ target: invoiceSequences.key })
  const rows = await tx.select().from(invoiceSequences).where(eq(invoiceSequences.key, key)).for('update')
  const row = rows[0]
  if (!row) throw new Error(tr('errors.invoicing.sequenceKeyNotCreated', { key }))

  const year = new Date().getUTCFullYear()
  let nextValue: number
  let lastResetYear = row.lastResetYear

  if (row.resetOn === 'year' && row.lastResetYear !== year) {
    nextValue = row.startFrom
    lastResetYear = year
  } else if (row.currentValue === 0 && row.lastResetYear === null) {
    // Prima alocare (acoperă și resetOn === 'never') — pornește de la startFrom.
    nextValue = row.startFrom
    lastResetYear = year
  } else {
    nextValue = row.currentValue + 1
  }

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
