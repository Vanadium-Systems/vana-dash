import { describe, expect, it } from 'vitest'
import type { NumbersList } from './contracts-api'
import { contractNumberConflict, formatContractDate, parseContractDate, suggestNextContractNumber } from './ClientFormDialog'

describe('parseContractDate', () => {
  it('parses dd.mm.yyyy into ISO', () => {
    expect(parseContractDate('24.07.2026')).toBe('2026-07-24')
  })

  it('parses Romanian spelled-out dates (contracte importate din recyclers_app)', () => {
    expect(parseContractDate('4 iunie 2026')).toBe('2026-06-04')
    expect(parseContractDate('24 iulie 2026')).toBe('2026-07-24')
  })

  it('returns empty string for unparseable input (nu crapă, doar arată gol în input[type=date])', () => {
    expect(parseContractDate('cine știe')).toBe('')
    expect(parseContractDate('')).toBe('')
  })
})

describe('formatContractDate', () => {
  it('formats ISO into dd.mm.yyyy', () => {
    expect(formatContractDate('2026-07-24')).toBe('24.07.2026')
  })

  it('round-trips with parseContractDate', () => {
    expect(formatContractDate(parseContractDate('4 iunie 2026'))).toBe('04.06.2026')
  })

  it('returns empty string for invalid ISO', () => {
    expect(formatContractDate('')).toBe('')
  })
})

describe('suggestNextContractNumber', () => {
  it('suggests 001 while the list has not arrived or the series is empty', () => {
    expect(suggestNextContractNumber(undefined)).toBe('001')
    expect(suggestNextContractNumber({ series: null, next: 1, items: [] })).toBe('001')
  })

  it('takes the label the server proposes, which already skips reserved numbers', () => {
    expect(suggestNextContractNumber({ series: null, next: 4, nextLabel: '004', items: [] })).toBe('004')
  })
})

describe('contractNumberConflict', () => {
  const numbers: NumbersList = {
    series: null,
    next: 4,
    nextLabel: '004',
    items: [
      { number: 3, label: '003', kind: 'reserved', reservationId: 'r1', note: 'Contract de colaborare' },
      { number: 2, label: '002', kind: 'used', contractId: 'c2', counterpartyName: 'Borealis Metal' },
      { number: 1, label: '001', kind: 'used', contractId: 'c1', counterpartyName: 'Acme Recycling' },
    ],
  }

  it('names what a reserved number is for, however it is typed', () => {
    expect(contractNumberConflict('003', numbers, null)).toBe('003 e rezervat: Contract de colaborare')
    expect(contractNumberConflict(' 3', numbers, null)).toBe('003 e rezervat: Contract de colaborare')
  })

  it('names the party that already has the number', () => {
    expect(contractNumberConflict('002', numbers, 'Acme Recycling')).toBe('002 e deja folosit la Borealis Metal')
  })

  it('does not flag a client against its own contract', () => {
    expect(contractNumberConflict('002', numbers, 'Borealis Metal')).toBeNull()
  })

  it('stays quiet for a free number, an empty field, no list or free text', () => {
    expect(contractNumberConflict('004', numbers, null)).toBeNull()
    expect(contractNumberConflict('', numbers, null)).toBeNull()
    expect(contractNumberConflict(undefined, numbers, null)).toBeNull()
    expect(contractNumberConflict('VS-12', numbers, null)).toBeNull()
    expect(contractNumberConflict('002', undefined, null)).toBeNull()
  })
})
