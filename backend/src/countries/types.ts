import { tr, type TrKey } from '../shared/lib/i18n.js'

// What the rest of the app may ask of a country. Grows only when a module needs it (a second
// country's rules, a new declaration), not ahead of time.

export interface CompanyAddress {
  county: string
  city: string
  street: string
  number: string
  details: string
  postalCode: string
}

/** The seller's address as an e-invoice and the tax declarations expect it. */
export interface SellerAddress {
  street: string
  city: string
  countyCode: string
  postalCode: string
}

export interface CountryPack {
  /** ISO 3166-1 alpha-2. */
  code: string
  defaultTimeZone: string
  defaultCurrency: string
  /** Throws CompanyProfileIncompleteError when the sheet lacks what this country requires. */
  sellerAddress(office: CompanyAddress): SellerAddress
}

export type CompanyField = 'name' | 'cui' | 'county' | 'city' | 'street' | 'declarant'

export class CompanyProfileIncompleteError extends Error {
  // Shown to the user as is (app.ts hides the message of a 5xx): it says which field to fill in.
  readonly statusCode = 422

  constructor(readonly fields: CompanyField[]) {
    super(tr('errors.company.incomplete', { fields: fields.map((f) => tr(`errors.company.fields.${f}` as TrKey)).join(', ') }))
  }
}
