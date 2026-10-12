import { describe, expect, it } from 'vitest'
import { t } from './i18n'

// Romanian counts: "1 fișier", "3 fișiere", "20 de fișiere", "101 fișiere". The rule of "de"
// comes from the CLDR plural forms (`one`, `few`, `other`), not from code.
describe('plural forms in Romanian', () => {
  it.each([
    [0, '0 fișiere'],
    [1, '1 fișier'],
    [3, '3 fișiere'],
    [19, '19 fișiere'],
    [20, '20 de fișiere'],
    [101, '101 fișiere'],
    [120, '120 de fișiere'],
    [1000, '1.000 de fișiere'],
  ])('%d', (count, expected) => {
    expect(t('common:count.files', { count })).toBe(expected)
  })
})

describe('t()', () => {
  it('fills in the variables of a text', () => {
    expect(t('common:access.denied.title', { page: 'Facturi' })).toBe('Nu ai acces la Facturi')
  })
})
