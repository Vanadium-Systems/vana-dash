import { describe, expect, it } from 'vitest'
import { AUTO_MATCH_THRESHOLD, scoreMatch } from './matching.js'

const invoice = {
  amount: 726,
  currency: 'RON',
  documentNumber: 'VAN-2026-0001',
  counterpartyName: 'Client SaaS SRL',
  clientIbanHmac: 'hmac-of-client-iban',
}

describe('scoreMatch', () => {
  it('returns 0 for different currency or amount', () => {
    const txn = { amount: 726, currency: 'EUR', counterpartyIbanHmac: null, counterpartyName: null, reference: null }
    expect(scoreMatch(txn, invoice)).toBe(0)
    expect(scoreMatch({ ...txn, currency: 'RON', amount: 725 }, invoice)).toBe(0)
  })

  it('amount-only match stays below the auto threshold', () => {
    const txn = { amount: 726, currency: 'RON', counterpartyIbanHmac: null, counterpartyName: null, reference: null }
    expect(scoreMatch(txn, invoice)).toBeLessThan(AUTO_MATCH_THRESHOLD)
  })

  it('two missing IBANs are not a match', () => {
    const txn = { amount: 726, currency: 'RON', counterpartyIbanHmac: null, counterpartyName: null, reference: null }
    expect(scoreMatch(txn, { ...invoice, clientIbanHmac: null })).toBeLessThan(AUTO_MATCH_THRESHOLD)
  })

  it('amount + IBAN passes the threshold', () => {
    const txn = {
      amount: 726,
      currency: 'RON',
      counterpartyIbanHmac: 'hmac-of-client-iban',
      counterpartyName: null,
      reference: null,
    }
    expect(scoreMatch(txn, invoice)).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD)
  })

  it('amount + reference containing the invoice number passes the threshold', () => {
    const txn = {
      amount: 726,
      currency: 'RON',
      counterpartyIbanHmac: null,
      counterpartyName: null,
      reference: 'plata van-2026-0001 multumim',
    }
    expect(scoreMatch(txn, invoice)).toBeGreaterThanOrEqual(AUTO_MATCH_THRESHOLD)
  })

  it('caps the score at 1', () => {
    const txn = {
      amount: 726,
      currency: 'RON',
      counterpartyIbanHmac: invoice.clientIbanHmac,
      counterpartyName: 'CLIENT SAAS SRL plati',
      reference: 'VAN-2026-0001',
    }
    expect(scoreMatch(txn, invoice)).toBe(1)
  })
})
