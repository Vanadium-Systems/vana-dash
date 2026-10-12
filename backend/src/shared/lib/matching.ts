// Scoring pur pentru reconcilierea automată tranzacție bancară ↔ factură.
// Regula din plan: sumă exactă + (IBAN counterparty SAU referință conține numărul
// facturii) → match auto. Sub prag rămâne nematchuit, pentru matching manual în UI.

export const AUTO_MATCH_THRESHOLD = 0.8

export interface MatchTxn {
  amount: number
  currency: string
  counterpartyIban: string | null
  counterpartyName: string | null
  reference: string | null
}

export interface MatchCandidate {
  amount: number
  currency: string
  documentNumber: string | null
  counterpartyName: string | null
  clientIban: string | null
}

function normalize(value: string): string {
  return value.toUpperCase().replace(/\s+/g, '')
}

export function scoreMatch(txn: MatchTxn, invoice: MatchCandidate): number {
  if (txn.currency !== invoice.currency) return 0
  // Suma exactă e condiția de bază — fără ea nu există match auto.
  if (Math.abs(txn.amount - invoice.amount) > 0.005) return 0

  let score = 0.6

  if (txn.counterpartyIban && invoice.clientIban && normalize(txn.counterpartyIban) === normalize(invoice.clientIban)) {
    score += 0.3
  }
  if (
    txn.reference &&
    invoice.documentNumber &&
    normalize(txn.reference).includes(normalize(invoice.documentNumber))
  ) {
    score += 0.35
  }
  if (
    txn.counterpartyName &&
    invoice.counterpartyName &&
    normalize(txn.counterpartyName).includes(normalize(invoice.counterpartyName).slice(0, 12))
  ) {
    score += 0.1
  }

  return Math.min(score, 1)
}
