import { describe, expect, it } from 'vitest'
import type { BillingClient } from '@/shared/lib/types'
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
  function client(nrContract: string | undefined): BillingClient {
    return { contractDetails: nrContract ? { nrContract } : null } as BillingClient
  }

  it('suggests 001 when there are no clients with a contract number yet', () => {
    expect(suggestNextContractNumber(undefined)).toBe('001')
    expect(suggestNextContractNumber([])).toBe('001')
  })

  it('suggests max + 1, padded to 3 digits', () => {
    expect(suggestNextContractNumber([client('001'), client('002')])).toBe('003')
  })

  it('ignores clients without a contract number and non-numeric junk', () => {
    expect(suggestNextContractNumber([client('001'), client(undefined), client('not-a-number')])).toBe('002')
  })

  it('does not assume list order — picks the true max', () => {
    expect(suggestNextContractNumber([client('003'), client('001'), client('002')])).toBe('004')
  })

  const reserved = (...numbers: string[]) => numbers.map((number) => ({ number, note: `Contract ${number}`, date: '2026-09-28' }))

  it('skips a reserved number: 001-002 used, 003 reserved → 004', () => {
    expect(suggestNextContractNumber([client('001'), client('002')], reserved('003'))).toBe('004')
  })

  it('skips consecutive reserved numbers and ignores the ones below the max', () => {
    expect(suggestNextContractNumber([client('004')], reserved('002', '005', '006'))).toBe('007')
  })
})

describe('contractNumberConflict', () => {
  const clients = [
    { id: 'a', name: 'Acme Recycling', contractDetails: { nrContract: '001' } },
    { id: 'b', name: 'Borealis Metal', contractDetails: { nrContract: '002' } },
  ] as BillingClient[]
  const reserved = [{ number: '003', note: 'Contract de colaborare', date: '2026-09-28' }]

  it('names what a reserved number is for, however it is typed', () => {
    expect(contractNumberConflict('003', clients, reserved, null)).toBe('003 e rezervat: Contract de colaborare')
    expect(contractNumberConflict(' 3', clients, reserved, null)).toBe('003 e rezervat: Contract de colaborare')
  })

  it('names the client that already has the number', () => {
    expect(contractNumberConflict('002', clients, reserved, null)).toBe('002 e deja folosit la Borealis Metal')
  })

  it('does not flag a client against its own number', () => {
    expect(contractNumberConflict('002', clients, reserved, 'b')).toBeNull()
  })

  it('stays quiet for a free number, an empty field or free text', () => {
    expect(contractNumberConflict('004', clients, reserved, null)).toBeNull()
    expect(contractNumberConflict('', clients, reserved, null)).toBeNull()
    expect(contractNumberConflict(undefined, clients, reserved, null)).toBeNull()
    expect(contractNumberConflict('VS-12', clients, reserved, null)).toBeNull()
  })
})
