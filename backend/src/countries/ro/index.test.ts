import { describe, expect, it } from 'vitest'
import { CompanyProfileIncompleteError } from '../types.js'
import { ro } from './index.js'

const office = { county: 'Cluj', city: 'Cluj-Napoca', street: 'Str. Exemplu', number: '1', details: 'Ap. 2', postalCode: '400001' }

describe('ro.sellerAddress', () => {
  it('joins the street parts and turns the county into its ISO code', () => {
    expect(ro.sellerAddress(office)).toEqual({ street: 'Str. Exemplu, 1, Ap. 2', city: 'Cluj-Napoca', countyCode: 'RO-CJ', postalCode: '400001' })
  })

  it('keeps a one-piece street exactly as written (the sheet imported from env)', () => {
    const address = ro.sellerAddress({ ...office, county: 'BUCURESTI', city: 'Bucuresti', street: 'Str. Test nr. 1', number: '', details: '' })
    expect(address.street).toBe('Str. Test nr. 1')
    expect(address.countyCode).toBe('RO-B')
  })

  it('names every missing field', () => {
    try {
      ro.sellerAddress({ ...office, county: '', street: ' ' })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(CompanyProfileIncompleteError)
      expect((err as CompanyProfileIncompleteError).fields).toEqual(['county', 'street'])
    }
  })

  it('refuses a county it does not know, since ANAF would reject the invoice', () => {
    expect(() => ro.sellerAddress({ ...office, county: 'Atlantis' })).toThrow(/Atlantis/)
  })
})
