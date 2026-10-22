/**
 * Unit test — funcție pură, fără DB/rețea. Acoperă matching-ul pe prefix CPV + keyword
 * (case-insensitive, în titlu SAU descriere CPV).
 */
import { describe, expect, it } from 'vitest'
import type { tenderWatchRules } from '../../shared/db/schema/index.js'
import { extractMinTurnoverRon, matchesAnyRule, matchWatchRule } from './e-licitatie-client.js'
import type { NormalizedTenderRow } from './types.js'

type WatchRule = typeof tenderWatchRules.$inferSelect

function makeRule(overrides: Partial<WatchRule>): WatchRule {
  return {
    id: 'rule-1',
    tenantId: '00000000-0000-4000-8000-000000000001',
    label: 'QA rule',
    cpvPrefix: null,
    keyword: null,
    active: true,
    highPriority: false,
    exclude: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  }
}

function makeRow(overrides: Partial<NormalizedTenderRow>): NormalizedTenderRow {
  return {
    source: 'direct_acquisition',
    externalId: 'QA-1',
    title: 'Achiziție echipamente birou',
    cpvCode: '30190000-7',
    cpvDescription: 'Echipament și consumabile de birou diverse',
    contractingAuthority: null,
    estimatedValueRon: null,
    procedureType: null,
    stateText: null,
    isOpen: true,
    publicationDate: null,
    deadlineAt: null,
    detailUrl: 'https://example.com',
    raw: {},
    ...overrides,
  }
}

describe('matchWatchRule', () => {
  it('potrivește pe prefixul CPV', () => {
    const rule = makeRule({ id: 'r-cpv', cpvPrefix: '72' })
    const row = makeRow({ cpvCode: '72000000-5' })
    expect(matchWatchRule(row, [rule])).toBe('r-cpv')
  })

  it('nu potrivește dacă prefixul CPV nu se regăsește', () => {
    const rule = makeRule({ id: 'r-cpv', cpvPrefix: '72' })
    const row = makeRow({ cpvCode: '30190000-7' })
    expect(matchWatchRule(row, [rule])).toBeNull()
  })

  it('potrivește pe keyword case-insensitive în titlu', () => {
    const rule = makeRule({ id: 'r-kw', keyword: 'digitalizare' })
    const row = makeRow({ title: 'Servicii de DIGITALIZARE arhivă' })
    expect(matchWatchRule(row, [rule])).toBe('r-kw')
  })

  it('potrivește pe keyword în descrierea CPV, nu doar titlu', () => {
    const rule = makeRule({ id: 'r-kw', keyword: 'platformă online' })
    const row = makeRow({ title: 'Achiziție servicii', cpvDescription: 'Dezvoltare platformă online de rezervări' })
    expect(matchWatchRule(row, [rule])).toBe('r-kw')
  })

  it('întoarce null când nicio regulă nu se potrivește', () => {
    const rules = [makeRule({ id: 'r1', cpvPrefix: '72' }), makeRule({ id: 'r2', keyword: 'digitalizare' })]
    const row = makeRow({ cpvCode: '30190000-7', title: 'Achiziție scaune', cpvDescription: 'Mobilier de birou' })
    expect(matchWatchRule(row, rules)).toBeNull()
  })

  it('ignoră regulile inactive doar dacă apelantul le filtrează în prealabil (matchWatchRule nu verifică `active`)', () => {
    const rule = makeRule({ id: 'r-inactive', cpvPrefix: '72', active: false })
    const row = makeRow({ cpvCode: '72000000-5' })
    // listActiveWatchRules() filtrează deja `active` — matchWatchRule primește doar reguli active în producție.
    expect(matchWatchRule(row, [rule])).toBe('r-inactive')
  })

  it('o regulă de prioritate înaltă câștigă în fața uneia normale, chiar dacă e mai la coadă în listă', () => {
    const normal = makeRule({ id: 'r-normal', cpvPrefix: '48', highPriority: false })
    const priority = makeRule({ id: 'r-priority', cpvPrefix: '48', highPriority: true })
    const row = makeRow({ cpvCode: '48900000-7' })
    // Ordinea din `rules` reflectă `createdAt asc` în producție — regula normală (mai veche) e prima.
    expect(matchWatchRule(row, [normal, priority])).toBe('r-priority')
  })

  it('fără nicio regulă de prioritate care se potrivește, întoarce prima regulă normală', () => {
    const first = makeRule({ id: 'r-first', cpvPrefix: '72' })
    const second = makeRule({ id: 'r-second', keyword: 'digitalizare' })
    const row = makeRow({ cpvCode: '72000000-5', title: 'Achiziție digitalizare' })
    expect(matchWatchRule(row, [first, second])).toBe('r-first')
  })
})

describe('matchesAnyRule', () => {
  it('true dacă potrivește pe keyword regula de excludere', () => {
    const rule = makeRule({ id: 'r-exclude', keyword: 'licență windows', exclude: true })
    const row = makeRow({ title: 'Achiziție licență Windows Server' })
    expect(matchesAnyRule(row, [rule])).toBe(true)
  })

  it('false dacă nicio regulă din listă nu potrivește', () => {
    const rule = makeRule({ id: 'r-exclude', cpvPrefix: '30', exclude: true })
    const row = makeRow({ cpvCode: '72000000-5' })
    expect(matchesAnyRule(row, [rule])).toBe(false)
  })

  it('true dacă oricare regulă din listă potrivește, nu doar prima', () => {
    const first = makeRule({ id: 'r1', cpvPrefix: '30', exclude: true })
    const second = makeRule({ id: 'r2', keyword: 'papetărie', exclude: true })
    const row = makeRow({ cpvCode: '72000000-5', title: 'Achiziție papetărie' })
    expect(matchesAnyRule(row, [first, second])).toBe(true)
  })
})

describe('extractMinTurnoverRon', () => {
  it('extrage cifra cu separator de mii și zecimale, format SEAP real', () => {
    const text = 'Media cifrei de afaceri generale anuale trebuie să fie mai mare sau egala cu  2.700.000,00 Lei (sau echivalent).'
    expect(extractMinTurnoverRon(text)).toBe(2_700_000)
  })

  it('extrage cifra fără separator de mii', () => {
    expect(extractMinTurnoverRon('Cifra de afaceri minimă: 50000 lei')).toBe(50_000)
  })

  it('ia valoarea cea mai mare când apar mai multe sume în text', () => {
    const text = 'Contracte cumulate de minim 1.804.000,00 lei; avans posibil de 50.000,00 lei.'
    expect(extractMinTurnoverRon(text)).toBe(1_804_000)
  })

  it('null când textul nu conține nicio sumă în lei/RON', () => {
    expect(extractMinTurnoverRon('Se completează DUAE conform Art. 193-195 din Legea 98/2016.')).toBeNull()
  })

  it('nu confundă numere fără sufix monetar (ani, articole de lege) cu un prag', () => {
    expect(extractMinTurnoverRon('Ofertantul trebuie să fi prestat în ultimii 3 ani, în cadrul a maxim 2 contracte.')).toBeNull()
  })
})
