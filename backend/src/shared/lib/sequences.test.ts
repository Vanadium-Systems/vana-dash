import { describe, expect, it } from 'vitest'
import { formatInvoiceNumber } from './sequences.js'

describe('formatInvoiceNumber', () => {
  it('formats with prefix, year and padding', () => {
    expect(
      formatInvoiceNumber({ prefix: 'VAN', separator: '-', yearFormat: 'yyyy', padding: 4, value: 7, year: 2026 }),
    ).toBe('VAN-2026-0007')
  })

  it('supports yy and no year', () => {
    expect(
      formatInvoiceNumber({ prefix: 'F', separator: '/', yearFormat: 'yy', padding: 3, value: 12, year: 2026 }),
    ).toBe('F/26/012')
    expect(
      formatInvoiceNumber({ prefix: '', separator: '-', yearFormat: 'none', padding: 0, value: 99, year: 2026 }),
    ).toBe('99')
  })
})
