import { tr } from '../../shared/lib/i18n.js'
import { countyNameToIsoCode } from '../../shared/lib/ro-counties.js'
import { CompanyProfileIncompleteError, type CompanyField, type CountryPack } from '../types.js'

export const ro: CountryPack = {
  code: 'RO',
  defaultTimeZone: 'Europe/Bucharest',
  defaultCurrency: 'RON',

  sellerAddress(office) {
    const missing: CompanyField[] = []
    if (!office.county.trim()) missing.push('county')
    if (!office.city.trim()) missing.push('city')
    if (!office.street.trim()) missing.push('street')
    if (missing.length) throw new CompanyProfileIncompleteError(missing)

    // CIUS-RO wants the county as an ISO 3166-2:RO code (BT-39); ANAF rejects the invoice without it.
    const countyCode = countyNameToIsoCode(office.county)
    if (!countyCode) throw new Error(tr('errors.company.countyUnknown', { county: office.county }))

    return {
      street: [office.street, office.number, office.details]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(', '),
      city: office.city.trim(),
      countyCode,
      postalCode: office.postalCode.trim(),
    }
  },
}
