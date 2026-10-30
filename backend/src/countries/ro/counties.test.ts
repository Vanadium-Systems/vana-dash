import { describe, expect, it } from 'vitest'
import { countyNameToIsoCode, extractBucharestSectorCode } from './counties.js'

describe('countyNameToIsoCode', () => {
  it('mapează nume uzuale, fără diacritice', () => {
    expect(countyNameToIsoCode('Brasov')).toBe('RO-BV')
    expect(countyNameToIsoCode('Cluj')).toBe('RO-CJ')
    expect(countyNameToIsoCode('Bucuresti')).toBe('RO-B')
  })

  it('mapează nume cu diacritice', () => {
    expect(countyNameToIsoCode('Brașov')).toBe('RO-BV')
    expect(countyNameToIsoCode('București')).toBe('RO-B')
    expect(countyNameToIsoCode('Mureș')).toBe('RO-MS')
  })

  it('e case-insensitive și trim', () => {
    expect(countyNameToIsoCode('  brasov  ')).toBe('RO-BV')
    expect(countyNameToIsoCode('BRASOV')).toBe('RO-BV')
  })

  it('acceptă cod deja formatat', () => {
    expect(countyNameToIsoCode('RO-BV')).toBe('RO-BV')
    expect(countyNameToIsoCode('BV')).toBe('RO-BV')
  })

  it('returnează undefined pt. text necunoscut sau lipsă', () => {
    expect(countyNameToIsoCode('Nu e un județ')).toBeUndefined()
    expect(countyNameToIsoCode(null)).toBeUndefined()
    expect(countyNameToIsoCode(undefined)).toBeUndefined()
    expect(countyNameToIsoCode('')).toBeUndefined()
  })
})

describe('extractBucharestSectorCode', () => {
  it('extrage sectorul din variante uzuale', () => {
    expect(extractBucharestSectorCode('Sector 1')).toBe('SECTOR1')
    expect(extractBucharestSectorCode('SECTORUL 2')).toBe('SECTOR2')
    expect(extractBucharestSectorCode('SECTORUL3')).toBe('SECTOR3')
    expect(extractBucharestSectorCode('sector4')).toBe('SECTOR4')
  })

  it('extrage sectorul din text liber (localitate ANAF sau adresă completă)', () => {
    // The city field held exactly this text on an invoice ANAF rejected.
    expect(extractBucharestSectorCode('Sector 1 Mun. București')).toBe('SECTOR1')
    expect(extractBucharestSectorCode('Str. Exemplu 10, Sector 5, București')).toBe('SECTOR5')
  })

  it('returnează undefined pt. sector în afara intervalului 1-6', () => {
    expect(extractBucharestSectorCode('Sector 7')).toBeUndefined()
    expect(extractBucharestSectorCode('Sector 0')).toBeUndefined()
  })

  it('returnează undefined pt. text fără mențiune de sector sau lipsă', () => {
    expect(extractBucharestSectorCode('București')).toBeUndefined()
    expect(extractBucharestSectorCode('S3')).toBeUndefined()
    expect(extractBucharestSectorCode(null)).toBeUndefined()
    expect(extractBucharestSectorCode(undefined)).toBeUndefined()
    expect(extractBucharestSectorCode('')).toBeUndefined()
  })
})
