import { describe, expect, it } from 'vitest'
import { EMPTY_COMPANY_PROFILE } from './company.js'
import { contractProvider } from './contract-templates.js'

describe('contractProvider', () => {
  it('writes the address as before: city first, then the street line', () => {
    const profile = {
      ...EMPTY_COMPANY_PROFILE,
      name: 'Acme SRL',
      registeredOffice: { county: 'BUCURESTI', city: 'Bucuresti', street: 'Str. Exemplu nr. 1', number: '', details: '', postalCode: '' },
    }
    expect(contractProvider(profile).adresa).toBe('Bucuresti, Str. Exemplu nr. 1')
  })
})
