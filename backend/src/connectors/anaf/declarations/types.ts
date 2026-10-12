// Tipuri pentru declarațiile D301 (decont special TVA, taxare inversă) și D390 (recapitulativă
// VIES). Structuri confirmate din PDF-urile oficiale ANAF (structura_D301_20130327.pdf,
// structura_D390_2020_180320.pdf) — vezi PLAN.md, Wave 0a, pentru research-ul complet.

export type ReverseChargeType = 'eu_services' | 'non_eu_services'

export interface DeclarationLine {
  reverseChargeType: ReverseChargeType
  documentNumber: string
  issuedAt: Date
  amountForeign: number
  currency: string
  fxRate: number
  baseRon: number
  vatRon: number
  /** Doar pt. eu_services — obligatoriu la D390. ISO-2, ex: 'DE'. */
  counterpartyCountry: string | null
  /** Doar pt. eu_services — VAT id-ul furnizorului fără prefixul de țară (ex: '123456789'). */
  counterpartyVatId: string | null
  counterpartyName: string
}

export interface CompanyIdentity {
  cif: string
  name: string
  address: string
  bank: string
  iban: string
  /** Prezent = înregistrat art. 317 (pers_inreg=2), gol = pers_inreg=1. */
  vatIntraCommunityCode: string
}

export interface Declarant {
  firstName: string
  lastName: string
  role: string
}
