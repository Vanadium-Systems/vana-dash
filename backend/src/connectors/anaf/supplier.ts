import { requireSeller, type Company } from '../../shared/lib/company.js'
import type { UblParty } from './types.js'

/** The supplier block of an e-Factura, from the company sheet. */
export function supplierParty(company: Company): UblParty {
  const seller = requireSeller(company)
  const { profile } = company
  return {
    name: seller.name,
    cif: seller.cui,
    regCom: profile.regCom || undefined,
    address: seller.address.street,
    city: seller.address.city,
    countyCode: seller.address.countyCode,
    country: seller.country,
    iban: profile.iban || undefined,
    bank: profile.bank || undefined,
    email: profile.email || undefined,
  }
}
