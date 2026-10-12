import { describe, expect, it } from 'vitest'
import { transformTransactions } from './transform.js'
import type { RevolutTransaction } from './types.js'

const transactions: RevolutTransaction[] = [
  {
    id: 'txn-1',
    type: 'transfer',
    state: 'completed',
    created_at: '2026-07-01T09:00:00Z',
    completed_at: '2026-07-01T09:05:00Z',
    reference: 'Plata factura VAN-2026-0001',
    legs: [
      {
        leg_id: 'leg-1',
        account_id: 'acc-ron',
        amount: 726,
        currency: 'RON',
        counterparty: { account_type: 'external', account_id: 'RO12BANK0000000000000001', name: 'Client SaaS SRL' },
      },
    ],
  },
  {
    id: 'txn-2',
    type: 'card_payment',
    state: 'completed',
    created_at: '2026-07-02T12:00:00Z',
    merchant: { name: 'Hetzner Online GmbH' },
    legs: [{ leg_id: 'leg-2', account_id: 'acc-eur', amount: -35.5, currency: 'EUR', description: 'Hetzner' }],
  },
  {
    id: 'txn-3',
    type: 'transfer',
    state: 'pending',
    created_at: '2026-07-03T08:00:00Z',
    legs: [{ leg_id: 'leg-3', account_id: 'acc-ron', amount: 100, currency: 'RON' }],
  },
]

describe('revolut transform', () => {
  it('maps completed transactions with direction and absolute amount', () => {
    const result = transformTransactions(transactions, null)
    expect(result).toHaveLength(2)

    const incoming = result.find((t) => t.externalId === 'txn-1')
    expect(incoming?.direction).toBe('in')
    expect(incoming?.amount).toBe(726)
    expect(incoming?.counterpartyName).toBe('Client SaaS SRL')
    expect(incoming?.counterpartyIban).toBe('RO12BANK0000000000000001')
    expect(incoming?.reference).toBe('Plata factura VAN-2026-0001')
    expect(incoming?.valueDate.toISOString()).toBe('2026-07-01T09:05:00.000Z')

    const outgoing = result.find((t) => t.externalId === 'txn-2')
    expect(outgoing?.direction).toBe('out')
    expect(outgoing?.amount).toBe(35.5)
    expect(outgoing?.counterpartyName).toBe('Hetzner Online GmbH')
  })

  it('skips pending transactions', () => {
    expect(transformTransactions(transactions, null).map((t) => t.externalId)).not.toContain('txn-3')
  })

  it('filters legs by accountRef when set', () => {
    const result = transformTransactions(transactions, 'acc-eur')
    expect(result.map((t) => t.externalId)).toEqual(['txn-2'])
  })
})
