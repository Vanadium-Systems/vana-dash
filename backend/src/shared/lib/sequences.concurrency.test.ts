/**
 * Concurrency test — pg real (vezi test/setup.ts). `nextInvoiceNumber` folosește
 * SELECT ... FOR UPDATE într-o tranzacție (regula CLAUDE.md: numerotare fără
 * goluri/duplicate sub concurență). Neacoperit în Wave 1 — sequences.test.ts
 * testează doar `formatInvoiceNumber` (funcție pură), nu alocarea sub concurență.
 * QA mandate (qa.agent.md): "numerotare facturi concurentă" e un test critic
 * obligatoriu la fiecare sprint.
 */
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../db/client.js'
import { invoiceSequences } from '../db/schema/index.js'
import { nextInvoiceNumber } from './sequences.js'

const KEY = `qa-concurrency-${Date.now()}`

afterAll(async () => {
  await db.delete(invoiceSequences).where(eq(invoiceSequences.key, KEY))
})

describe('nextInvoiceNumber — concurrent allocation', () => {
  it('issues N parallel requests and gets N unique, gap-free numbers', async () => {
    const CONCURRENCY = 20
    const numbers = await Promise.all(
      Array.from({ length: CONCURRENCY }, () => nextInvoiceNumber(KEY)),
    )

    const unique = new Set(numbers)
    expect(unique.size).toBe(CONCURRENCY)

    // Extrage valorile numerice (ultimul segment, ex: VAN-2026-0007 → 7) și verifică
    // că formează exact 1..CONCURRENCY fără goluri și fără duplicate.
    const values = numbers
      .map((n) => Number(n.split('-').pop()))
      .sort((a, b) => a - b)
    expect(values).toEqual(Array.from({ length: CONCURRENCY }, (_, i) => i + 1))

    const [row] = await db.select().from(invoiceSequences).where(eq(invoiceSequences.key, KEY))
    expect(row?.currentValue).toBe(CONCURRENCY)
  })

  it('a rolled-back transaction does not consume a number (no gap left behind)', async () => {
    const before = await nextInvoiceNumber(KEY)
    const beforeValue = Number(before.split('-').pop())

    await expect(
      db.transaction(async (tx) => {
        await nextInvoiceNumber(KEY, tx)
        throw new Error('force rollback')
      }),
    ).rejects.toThrow('force rollback')

    const after = await nextInvoiceNumber(KEY)
    const afterValue = Number(after.split('-').pop())
    // Dacă rollback-ul chiar anulează alocarea, următorul număr e beforeValue+1,
    // nu beforeValue+2 (ceea ce ar însemna că numărul "pierdut" în rollback a
    // fost totuși consumat definitiv).
    expect(afterValue).toBe(beforeValue + 1)
  })
})
