import type { BankTransaction } from '../types.js'
import type { RevolutTransaction, RevolutTransactionLeg } from './types.js'

// Mapare tranzacții Revolut → BankTransaction comun.
// O tranzacție Revolut poate avea mai multe legs (ex: exchange între conturi proprii);
// reținem leg-ul contului sincronizat (sau primul, dacă accountRef lipsește).

function pickLeg(txn: RevolutTransaction, accountRef: string | null): RevolutTransactionLeg | null {
  if (!txn.legs?.length) return null
  if (!accountRef) return txn.legs[0] ?? null
  return txn.legs.find((leg) => leg.account_id === accountRef) ?? null
}

export function transformTransactions(
  transactions: RevolutTransaction[],
  accountRef: string | null,
): BankTransaction[] {
  const result: BankTransaction[] = []
  for (const txn of transactions) {
    // Doar tranzacțiile finalizate intră în reconciliere.
    if (txn.state !== 'completed') continue
    const leg = pickLeg(txn, accountRef)
    if (!leg) continue

    result.push({
      externalId: txn.id,
      amount: Math.abs(leg.amount),
      currency: leg.currency,
      counterpartyName: leg.counterparty?.name ?? txn.merchant?.name ?? null,
      counterpartyIban: leg.counterparty?.account_id ?? null,
      reference: txn.reference ?? leg.description ?? null,
      valueDate: new Date(txn.completed_at ?? txn.created_at),
      direction: leg.amount < 0 ? 'out' : 'in',
      rawMeta: { type: txn.type, legId: leg.leg_id },
    })
  }
  return result
}
