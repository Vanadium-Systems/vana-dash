// Tipuri specifice API-urilor ANAF (e-Factura FCTEL + SPV).

/** Un mesaj din listaMesajePaginatieFactura / listaMesaje (FCTEL). */
export interface AnafEfacturaMessage {
  id: string
  data_creare: string // format: yyyyMMddHHmm
  cif: string
  id_solicitare: string
  detalii: string
  tip: string // 'FACTURA PRIMITA' | 'FACTURA TRIMISA' | 'ERORI FACTURA' | 'MESAJ CUMPARATOR'
}

export interface AnafListaMesajeResponse {
  mesaje?: AnafEfacturaMessage[]
  numar_inregistrari_in_pagina?: number
  numar_total_pagini?: number
  numar_total_inregistrari?: number
  eroare?: string
  titlu?: string
}

export interface AnafTokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
}

export interface AnafTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
}

/** Datele necesare construirii unui XML UBL 2.1 CIUS-RO pentru o factură emisă. */
export interface UblInvoiceInput {
  documentNumber: string
  issuedAt: Date
  dueAt: Date | null
  currency: string
  supplier: UblParty
  customer: UblParty
  lines: UblInvoiceLine[]
  /** Notă liberă pe factură (opțional). */
  note?: string
}

export interface UblParty {
  name: string
  cif: string
  regCom?: string
  address: string
  city: string
  /** Cod CIUS-RO pentru județ (ex: RO-B, RO-CJ). Obligatoriu pentru supplier. */
  countyCode?: string
  country: string
  iban?: string
  bank?: string
  email?: string
}

export interface UblInvoiceLine {
  description: string
  quantity: number
  unitPrice: number
  /** Cota TVA în procente; 0 = neplătitor de TVA (categoria O). */
  vatRate: number
}

export interface UblInvoiceTotals {
  lineExtensionAmount: number
  taxAmount: number
  taxInclusiveAmount: number
  /** Sume grupate pe cotă TVA — necesare pentru TaxSubtotal. */
  byRate: Array<{ rate: number; taxable: number; tax: number }>
}
