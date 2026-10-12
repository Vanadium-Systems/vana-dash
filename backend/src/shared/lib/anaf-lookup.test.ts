// The fixture has the shape of a real ANAF answer; the company in it is invented.
import { describe, expect, it } from 'vitest'
import { mapEntry, mapStare } from './anaf-lookup.js'
import type { AnafFoundEntry } from './anaf-lookup.js'

const ACME_ENTRY = {
  date_generale: {
    denumire: 'ACME RECYCLING S.R.L.',
    stare_inregistrare: 'INREGISTRAT din data 15.03.2021',
  },
  inregistrare_scop_Tva: { scpTVA: false },
  stare_inactiv: { statusInactivi: false, dataRadiere: '' },
  adresa_sediu_social: {
    sdenumire_Strada: 'Str. Exemplu',
    snumar_Strada: '7',
    sdenumire_Localitate: 'Mun. Braşov',
    sdenumire_Judet: 'BRAŞOV',
  },
}

describe('mapEntry', () => {
  it('mapează o intrare reală, activă, neplătitoare de TVA', () => {
    expect(mapEntry(ACME_ENTRY)).toEqual({
      name: 'ACME RECYCLING S.R.L.',
      address: { street: 'Str. Exemplu 7', locality: 'Mun. Braşov', county: 'BRAŞOV' },
      isVatPayer: false,
      stare: 'activ',
    })
  })

  it('mapează un plătitor de TVA', () => {
    const entry = { ...ACME_ENTRY, inregistrare_scop_Tva: { scpTVA: true } }
    expect(mapEntry(entry).isVatPayer).toBe(true)
  })

  it('aruncă dacă lipsește denumirea', () => {
    const entry = { ...ACME_ENTRY, date_generale: {} }
    expect(() => mapEntry(entry)).toThrow(/denumirea/)
  })

  it('tratează adresa lipsă (toate câmpurile null)', () => {
    const entry: AnafFoundEntry = { ...ACME_ENTRY, adresa_sediu_social: undefined }
    expect(mapEntry(entry).address).toEqual({ street: null, locality: null, county: null })
  })
})

describe('mapEntry — București (BR-RO-100)', () => {
  const BUCHAREST_ENTRY = {
    date_generale: { denumire: 'ACME METAL SRL' },
    inregistrare_scop_Tva: { scpTVA: true },
    stare_inactiv: { statusInactivi: false, dataRadiere: '' },
    adresa_sediu_social: {
      sdenumire_Strada: 'Str. Exemplu',
      snumar_Strada: '10',
      sdenumire_Localitate: 'SECTOR 1',
      sdenumire_Judet: 'MUNICIPIUL BUCURESTI',
    },
  }

  it('normalizează localitatea la SECTORx când ANAF o dă deja ca "SECTOR N"', () => {
    expect(mapEntry(BUCHAREST_ENTRY).address.locality).toBe('SECTOR1')
  })

  it('deduce sectorul din adresă când localitatea nu-l conține', () => {
    const entry = {
      ...BUCHAREST_ENTRY,
      adresa_sediu_social: { ...BUCHAREST_ENTRY.adresa_sediu_social, sdenumire_Strada: 'Str. Exemplu, Sector 3', sdenumire_Localitate: 'BUCURESTI' },
    }
    expect(mapEntry(entry).address.locality).toBe('SECTOR3')
  })

  it('lasă localitatea nealterată în afara Bucureștiului', () => {
    expect(mapEntry(ACME_ENTRY).address.locality).toBe('Mun. Braşov')
  })
})

describe('mapStare', () => {
  it('activ — statusInactivi false, fără dataRadiere', () => {
    expect(mapStare({ statusInactivi: false, dataRadiere: '' })).toBe('activ')
  })
  it('inactiv — statusInactivi true, fără dataRadiere', () => {
    expect(mapStare({ statusInactivi: true, dataRadiere: '' })).toBe('inactiv')
  })
  it('radiat — dataRadiere are prioritate peste statusInactivi', () => {
    expect(mapStare({ statusInactivi: true, dataRadiere: '2025-01-15' })).toBe('radiat')
  })
  it('activ — implicit când lipsește stare_inactiv', () => {
    expect(mapStare(undefined)).toBe('activ')
  })
})
