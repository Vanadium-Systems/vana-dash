import { describe, expect, it } from 'vitest'
import { EMPTY_COMPANY_PROFILE } from '../../shared/lib/company.js'
import { companyDetails } from './template-render.js'

describe('companyDetails', () => {
  it('writes the address on one line: city first, then the street line', () => {
    const profile = {
      ...EMPTY_COMPANY_PROFILE,
      name: 'Acme SRL',
      registeredOffice: { county: 'BUCURESTI', city: 'Bucuresti', street: 'Str. Exemplu nr. 1', number: '', details: '', postalCode: '' },
    }
    expect(companyDetails(profile).adresa).toBe('Bucuresti, Str. Exemplu nr. 1')
  })
})
