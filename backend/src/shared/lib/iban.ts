import { encryptField, hmacField } from './crypto.js'

/** The form IBANs are compared in: upper case, no spaces. */
export function normalizeIban(iban: string): string {
  return iban.toUpperCase().replace(/\s+/g, '')
}

/** What gets stored for an IBAN: the encrypted value and the HMAC of its normalized form. */
export async function protectIban(iban: string | null | undefined): Promise<{ enc: string | null; hmac: string | null }> {
  const value = iban?.trim()
  if (!value) return { enc: null, hmac: null }
  return { enc: await encryptField(value), hmac: await hmacField(normalizeIban(value)) }
}
