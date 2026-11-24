import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { contractNumbers, contracts, contractSeries } from '../../shared/db/schema/index.js'
import { recordAudit } from '../../shared/lib/audit.js'
import { httpError } from '../../shared/lib/http-error.js'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Executor = Tx | typeof db

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string }).code === '23505' || (err as { cause?: { code?: string } }).cause?.code === '23505'
}

export function formatContractNumber(numberFormat: string, code: string, n: number): string {
  return numberFormat.replace('{code}', code).replace(/\{n(?::(\d))?\}/, (_m, width: string | undefined) => String(n).padStart(Number(width ?? 1), '0'))
}

export async function getSeries(seriesId: string, executor: Executor = db) {
  const [series] = await executor
    .select()
    .from(contractSeries)
    .where(and(eq(contractSeries.id, seriesId), isNull(contractSeries.deletedAt)))
  if (!series) throw httpError(404, 'CONTRACT_SERIES_NOT_FOUND')
  return series
}

/** The series used when nothing else is chosen: the oldest live one. */
export async function defaultSeries(executor: Executor = db) {
  const [series] = await executor
    .select()
    .from(contractSeries)
    .where(isNull(contractSeries.deletedAt))
    .orderBy(asc(contractSeries.createdAt))
    .limit(1)
  return series ?? null
}

/** The proposal: one after the highest number taken or reserved. Gaps are only used when picked. */
export async function nextNumber(seriesId: string, executor: Executor = db): Promise<number> {
  const [row] = await executor
    .select({ max: sql<number | null>`max(${contractNumbers.number})` })
    .from(contractNumbers)
    .where(eq(contractNumbers.seriesId, seriesId))
  return (row?.max ?? 0) + 1
}

/**
 * Gives the number to the contract inside the caller's transaction. A number reserved for nobody in
 * particular may be taken; one used by another contract may not. The unique index settles two
 * requests racing for the same number: the second waits for the first and then fails with 409.
 */
export async function claimNumber(tx: Tx, seriesId: string, number: number, contractId: string): Promise<void> {
  const [taken] = await tx
    .update(contractNumbers)
    .set({ kind: 'used', contractId, updatedAt: new Date() })
    .where(and(eq(contractNumbers.seriesId, seriesId), eq(contractNumbers.number, number), eq(contractNumbers.kind, 'reserved')))
    .returning({ id: contractNumbers.id })
  if (!taken) {
    const [own] = await tx
      .select({ id: contractNumbers.id })
      .from(contractNumbers)
      .where(and(eq(contractNumbers.seriesId, seriesId), eq(contractNumbers.number, number), eq(contractNumbers.contractId, contractId)))
    if (!own) {
      try {
        await tx.insert(contractNumbers).values({ seriesId, number, kind: 'used', contractId })
      } catch (err) {
        if (isUniqueViolation(err)) throw httpError(409, 'CONTRACT_NUMBER_TAKEN', { number: String(number) })
        throw err
      }
    }
  }
  await tx.update(contracts).set({ seriesId, number, updatedAt: new Date() }).where(eq(contracts.id, contractId))
}

/** Frees whatever number the contract holds (a deleted draft, a SaaS client whose number changed). */
export async function releaseNumber(tx: Tx, contractId: string): Promise<void> {
  await tx.delete(contractNumbers).where(eq(contractNumbers.contractId, contractId))
  await tx.update(contracts).set({ number: null, updatedAt: new Date() }).where(eq(contracts.id, contractId))
}

export type NumberListItem = {
  number: number
  label: string
  kind: 'used' | 'reserved' | 'free'
  reservationId?: string
  note?: string | null
  contractId?: string
  counterpartyName?: string
  date?: string | null
  contractStatus?: string
}

/** Every number from 1 to the highest one, the gaps included as free. */
export async function listNumbers(seriesId?: string) {
  const series = seriesId ? await getSeries(seriesId) : await defaultSeries()
  if (!series) return { series: null, next: 1, items: [] as NumberListItem[] }
  const rows = await db
    .select({
      id: contractNumbers.id,
      number: contractNumbers.number,
      kind: contractNumbers.kind,
      note: contractNumbers.note,
      createdAt: contractNumbers.createdAt,
      contractId: contracts.id,
      counterpartyName: contracts.counterpartyName,
      signedOn: contracts.signedOn,
      status: contracts.status,
    })
    .from(contractNumbers)
    .leftJoin(contracts, eq(contracts.id, contractNumbers.contractId))
    .where(eq(contractNumbers.seriesId, series.id))
    .orderBy(asc(contractNumbers.number))
  const byNumber = new Map(rows.map((r) => [r.number, r]))
  const max = rows.at(-1)?.number ?? 0
  const items: NumberListItem[] = []
  for (let n = max; n >= 1; n--) {
    const label = formatContractNumber(series.numberFormat, series.code, n)
    const row = byNumber.get(n)
    if (!row) items.push({ number: n, label, kind: 'free' })
    else if (row.kind === 'reserved') {
      items.push({ number: n, label, kind: 'reserved', reservationId: row.id, note: row.note, date: row.createdAt.toISOString().slice(0, 10) })
    } else {
      items.push({
        number: n,
        label,
        kind: 'used',
        contractId: row.contractId ?? undefined,
        counterpartyName: row.counterpartyName ?? undefined,
        date: row.signedOn,
        contractStatus: row.status ?? undefined,
      })
    }
  }
  return {
    series: { id: series.id, code: series.code, name: series.name, numberFormat: series.numberFormat },
    next: max + 1,
    nextLabel: formatContractNumber(series.numberFormat, series.code, max + 1),
    items,
  }
}

export async function reserveNumber(input: { seriesId: string; number: number; note: string }) {
  await getSeries(input.seriesId)
  try {
    const [row] = await db
      .insert(contractNumbers)
      .values({ seriesId: input.seriesId, number: input.number, kind: 'reserved', note: input.note })
      .returning()
    await recordAudit({ action: 'contract.numar.rezervat', entityType: 'contract_number', entityId: row!.id, changes: { numar: [null, input.number] } })
    return row!
  } catch (err) {
    if (isUniqueViolation(err)) throw httpError(409, 'CONTRACT_NUMBER_TAKEN', { number: String(input.number) })
    throw err
  }
}

export async function deleteReservation(id: string): Promise<boolean> {
  const [row] = await db
    .delete(contractNumbers)
    .where(and(eq(contractNumbers.id, id), eq(contractNumbers.kind, 'reserved')))
    .returning()
  if (row) await recordAudit({ action: 'contract.numar.eliberat', entityType: 'contract_number', entityId: row.id, changes: { numar: [row.number, null] } })
  return Boolean(row)
}

// ── Series ───────────────────────────────────────────────────────────────────────────────────

export async function listSeries() {
  return db.select().from(contractSeries).where(isNull(contractSeries.deletedAt)).orderBy(asc(contractSeries.createdAt))
}

export async function createSeries(input: { code: string; name: string; numberFormat: string }) {
  try {
    const [row] = await db.insert(contractSeries).values(input).returning()
    return row!
  } catch (err) {
    if (isUniqueViolation(err)) throw httpError(409, 'CONTRACT_SERIES_CODE_TAKEN', { code: input.code })
    throw err
  }
}

export async function updateSeries(id: string, input: { code: string; name: string; numberFormat: string }) {
  await getSeries(id)
  try {
    const [row] = await db.update(contractSeries).set({ ...input, updatedAt: new Date() }).where(eq(contractSeries.id, id)).returning()
    return row!
  } catch (err) {
    if (isUniqueViolation(err)) throw httpError(409, 'CONTRACT_SERIES_CODE_TAKEN', { code: input.code })
    throw err
  }
}
