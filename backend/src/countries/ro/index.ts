import { tr } from '../../shared/lib/i18n.js'
import { countyNameToIsoCode } from './counties.js'
import { lookupCompany, normalizePhone } from './company-lookup.js'
import { CompanyProfileIncompleteError, type CompanyField, type CountryPack } from '../types.js'

export const ro: CountryPack = {
  code: 'RO',
  defaultTimeZone: 'Europe/Bucharest',
  defaultCurrency: 'RON',
  normalizePhone,

  async lookupCompany(taxId) {
    const info = await lookupCompany(taxId)
    return { name: info.name, address: info.address, caen: info.caen, isActive: info.stare === 'activ' }
  },

  // D301 and D390 for month M are due on the 25th of M+1. Three periods back, so a missed one
  // stays visible as overdue for about two months.
  declarationDeadlines(now) {
    return [0, 1, 2].flatMap((back) => {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
      const period = start.toISOString().slice(0, 7)
      const dueAt = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 25))
      return (['D301', 'D390'] as const).map((code) => ({ code, period, dueAt }))
    })
  },

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
