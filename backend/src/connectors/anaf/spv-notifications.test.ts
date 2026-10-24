import { describe, expect, it } from 'vitest'
import { parseForm150Email, parseSpvDocumentsEmail } from './spv-notifications.js'

const ROUTINE_ONLY = `Ați primit următoarele documente în Spațiul Privat Virtual (SPV) ANAF:

- CIF 12345674: Document Fisa Rol pentru CIF=12345674 (cod arondare 083001) in format PDF cu documente in format tabelar atasate
- CIF 12345674: duplicat VECTOR FISCAL pentru CUI 12345674

Mesaj automat.`

const WITH_RECEIPT = `Ați primit următoarele documente în Spațiul Privat Virtual (SPV) ANAF:

- CIF 12345674: duplicat Istoric declaratii pentru CUI 12345674 pentru anul 2026
- CIF 90000014: recipisa pentru CIF 90000014, tip D301, numar_inregistrare INTERNT-1000000001-2026/02-11-2026, perioada raportare 9.2026
- CIF 90000014: Notificare privind nedepunerea declaratiilor

Mesaj automat.`

describe('parseSpvDocumentsEmail', () => {
  it('marks the daily fiscal record and duplicates as routine', () => {
    const items = parseSpvDocumentsEmail(ROUTINE_ONLY)
    expect(items.map((i) => i.kind)).toEqual(['routine', 'routine'])
    expect(items[0]!.cif).toBe('12345674')
  })

  it('reads a receipt: declaration, period, index and registration number', () => {
    const receipt = parseSpvDocumentsEmail(WITH_RECEIPT).find((i) => i.kind === 'receipt')
    expect(receipt).toMatchObject({
      cif: '90000014',
      declarationCode: 'D301',
      period: '2026-09',
      anafIndex: '1000000001',
      registrationNumber: 'INTERNT-1000000001-2026',
    })
  })

  it('treats anything it does not know as important', () => {
    const items = parseSpvDocumentsEmail(WITH_RECEIPT)
    expect(items.find((i) => i.text.startsWith('Notificare'))?.kind).toBe('important')
  })

  it('never files an error as routine or as a receipt', () => {
    const [item] = parseSpvDocumentsEmail('- CIF 1: Fisa Rol - document respins, eroare citire semnatura')
    expect(item!.kind).toBe('important')
  })
})

describe('parseForm150Email', () => {
  it('reads the request number and whether it was rejected', () => {
    const result = parseForm150Email(
      'Depunere Formular 150 numar inregistrare 2800000001',
      'Ca urmare a analizei Formularului 150, solicitarea dumneavoastra a fost respinsa intrucat: Documente neconforme.',
    )
    expect(result).toMatchObject({ formNumber: '2800000001', rejected: true })
  })

  it('ignores other admin.portal emails', () => {
    expect(parseForm150Email('Cod validare email', 'Codul de validare este 123456')).toBeNull()
  })
})
