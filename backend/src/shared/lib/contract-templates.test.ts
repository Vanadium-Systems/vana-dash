/**
 * shared/lib/contract-templates.ts: `assertContractDataComplete`, `formatMonthlyPrice` and the
 * HTML rendering. Pure functions, no database. The rendering tests check the engine (which
 * fragment lands where, escaping, unknown tokens), not the wording of the sample texts.
 */
import { describe, expect, it } from 'vitest'
import type { billingClients } from '../db/schema/billing-clients.js'
import type { ContractAddendum } from '../db/schema/contract-addenda.js'
import type { ContractDetails } from '../../modules/contracts/schema.js'
import {
  assertContractDataComplete,
  formatMonthlyPrice,
  renderActAditionalHtml,
  renderAnexaHtml,
  renderBlankHtml,
  renderContractHtml,
  CONTRACT_TEMPLATE_BODIES,
  CONTRACT_TEMPLATE_KEYS,
  CONTRACT_TEMPLATE_PLACEHOLDERS,
  DEFAULT_CONTRACT_FRAGMENTS,
  DEFAULT_CONTRACT_TERMS,
  type ContractFragments,
} from './contract-templates.js'
import { LUNA_GRATUITA_KEYS } from './contract-template-bodies.js'

type BillingClientRow = typeof billingClients.$inferSelect

function makeClient(overrides: Partial<BillingClientRow> = {}): BillingClientRow {
  return {
    id: 'client-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    name: 'Test Client SRL',
    slug: null,
    cif: '12345678',
    regCom: 'J08/1/2020',
    address: 'Str. Test 1',
    city: null,
    county: null,
    country: 'RO',
    iban: null,
    bank: null,
    email: 'client@example.com',
    vanagreenTenantId: null,
    platformId: null,
    needsBillingInfo: false,
    vanagreenExtendMonths: null,
    subscriptionPriceLei: null,
    subscriptionPriceEur: '100',
    subscriptionPriceCurrency: 'eur',
    autoInvoiceEnabled: false,
    billingCycle: 'monthly',
    billingCycleDay: null,
    billingCycleMonth: null,
    billingDueDate: null,
    paymentTermsDays: null,
    billingReminder7dSentAt: null,
    billingReminder1dSentAt: null,
    billingOverdueSentAt: null,
    contactName: 'Ion Popescu',
    contactTitle: 'Administrator',
    phone: '0722000000',
    contractPlan: 'Standard',
    contractDetails: null,
    ...overrides,
  } as BillingClientRow
}

const completeDetails: ContractDetails = {
  nrContract: '010',
  dataContract: '1 august 2026',
  taxaInitiere: '100 EUR',
  facturareTip: 'LUNAR',
}

describe('assertContractDataComplete', () => {
  it('does not throw when all required fields are present', () => {
    expect(() => assertContractDataComplete(makeClient(), completeDetails)).not.toThrow()
  })

  it('throws with the exact list of missing fields (billing_clients columns)', () => {
    const client = makeClient({ contactName: null, contactTitle: null, phone: null, contractPlan: null })
    expect(() => assertContractDataComplete(client, completeDetails)).toThrow(
      /Reprezentant client.*Funcție reprezentant.*Telefon client.*Plan/,
    )
  })

  it('throws when neither subscriptionPriceLei nor subscriptionPriceEur is set', () => {
    const client = makeClient({ subscriptionPriceEur: null, subscriptionPriceLei: null })
    expect(() => assertContractDataComplete(client, completeDetails)).toThrow(/Tarif abonament/)
  })

  it('does not require subscriptionPriceEur when currency is lei and subscriptionPriceLei is set', () => {
    const client = makeClient({ subscriptionPriceCurrency: 'lei', subscriptionPriceLei: '400', subscriptionPriceEur: null })
    expect(() => assertContractDataComplete(client, completeDetails)).not.toThrow()
  })

  it('throws when contractDetails is missing nrContract/dataContract/taxaInitiere/facturareTip', () => {
    expect(() => assertContractDataComplete(makeClient(), {})).toThrow(
      /Număr contract.*Data contract.*Taxă de inițiere.*Ciclu de facturare/,
    )
  })
})

describe('formatMonthlyPrice', () => {
  it('formats EUR when currency is eur', () => {
    expect(formatMonthlyPrice(makeClient({ subscriptionPriceCurrency: 'eur', subscriptionPriceEur: '33.33' }))).toBe('33.33 EUR/lună')
  })

  it('formats RON when currency is lei', () => {
    expect(formatMonthlyPrice(makeClient({ subscriptionPriceCurrency: 'lei', subscriptionPriceLei: '400', subscriptionPriceEur: null }))).toBe(
      '400 RON/lună',
    )
  })

  it('falls back to em-dash when no price is set', () => {
    expect(formatMonthlyPrice(makeClient({ subscriptionPriceCurrency: 'eur', subscriptionPriceEur: null, subscriptionPriceLei: null }))).toBe('—')
  })

  it('divides by 12 for billingCycle=annual (bug găsit 2026-08-01, import al unui client: 400 EUR/an stocat, nu 400 EUR/lună)', () => {
    const client = makeClient({ billingCycle: 'annual', subscriptionPriceCurrency: 'eur', subscriptionPriceEur: '400' })
    expect(formatMonthlyPrice(client)).toBe('33,33 EUR/lună (echivalent 400 EUR/an, facturat anual)')
  })

  it('divides by 12 for RON annual too', () => {
    const client = makeClient({ billingCycle: 'annual', subscriptionPriceCurrency: 'lei', subscriptionPriceLei: '1200', subscriptionPriceEur: null })
    expect(formatMonthlyPrice(client)).toBe('100 RON/lună (echivalent 1200 RON/an, facturat anual)')
  })
})

const PRICE = '100 EUR/lună'
const PROVIDER = {
  nume: 'Acme Software SRL',
  cui: 'RO12345678',
  nrRegCom: 'J40/1/2020',
  adresa: 'Bucuresti, Str. Exemplu 1',
  reprezentant: 'Ion Popescu',
  email: 'contact@example.com',
  telefon: '0700000000',
}

function makeAddendum(overrides: Partial<ContractAddendum> = {}): ContractAddendum {
  return {
    id: 'add-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    billingClientId: 'client-1',
    number: 1,
    issuedAt: '2026-07-20',
    oldPriceNote: '100 RON/lună (fără TVA)',
    newPriceNote: '40 EUR/lună (fără TVA)',
    reason: 'extinderea Serviciului',
    effectiveDateNote: 'data semnării',
    temporary: false,
    reversionNote: null,
    ...overrides,
  } as ContractAddendum
}

// Every fragment is replaced by a marker naming it, so a test can tell which variant the engine
// picked without depending on the wording.
const MARKED_FRAGMENTS: ContractFragments = {
  sectiuneTemporaraAct: '[temporar: {{notaRevenire}}]',
  subprocesorAiExtra: '[subprocesor-ai]',
  paragrafTransferuriCuAi: '[transferuri-cu-ai]',
  paragrafTransferuriFaraAi: '[transferuri-fara-ai]',
  cuLunaGratuita: Object.fromEntries(LUNA_GRATUITA_KEYS.map((key) => [key, `[cu:${key}]`])) as ContractFragments['cuLunaGratuita'],
  faraLunaGratuita: Object.fromEntries(LUNA_GRATUITA_KEYS.map((key) => [key, `[fara:${key}]`])) as ContractFragments['faraLunaGratuita'],
}

function renderMarked(details: ContractDetails) {
  const data = { client: makeClient(), details, monthlyPriceFormatted: PRICE, provider: PROVIDER }
  return {
    contract: renderContractHtml(data, DEFAULT_CONTRACT_TERMS, CONTRACT_TEMPLATE_BODIES['contract-saas'], MARKED_FRAGMENTS),
    anexa: renderAnexaHtml(data, DEFAULT_CONTRACT_TERMS, CONTRACT_TEMPLATE_BODIES['anexa-preturi'], MARKED_FRAGMENTS),
  }
}

describe('the sample templates', () => {
  it('use only tokens the template screen documents, so an unedited body can be saved back', () => {
    for (const key of CONTRACT_TEMPLATE_KEYS) {
      const documented = new Set(CONTRACT_TEMPLATE_PLACEHOLDERS[key].map((doc) => doc.token))
      const used = [...CONTRACT_TEMPLATE_BODIES[key].matchAll(/\{\{([a-zA-Z0-9._]+)\}\}/g)].map((match) => match[1]!)
      expect(used.filter((token) => !documented.has(token))).toEqual([])
    }
  })

  it('render in every variant without an unknown token', () => {
    for (const areLunaGratuita of [true, false]) {
      for (const moduleAddon of ['VanaGreen AI', 'Tratări']) {
        const data = { client: makeClient(), details: { ...completeDetails, areLunaGratuita, moduleAddon }, monthlyPriceFormatted: PRICE, provider: PROVIDER }
        expect(() => renderContractHtml(data)).not.toThrow()
        expect(() => renderAnexaHtml(data)).not.toThrow()
      }
    }
    for (const temporary of [true, false]) {
      expect(() => renderActAditionalHtml(makeAddendum({ temporary }), makeClient(), { nrContract: '001', dataContract: '4 iunie 2026' }, PROVIDER)).not.toThrow()
    }
  })

  it('say they are samples', () => {
    for (const key of CONTRACT_TEMPLATE_KEYS) expect(CONTRACT_TEMPLATE_BODIES[key]).toContain('Text de exemplu')
  })

  it('keep the data processing agreement in the same document as the contract', () => {
    const html = renderContractHtml({ client: makeClient(), details: completeDetails, monthlyPriceFormatted: PRICE, provider: PROVIDER })
    expect(html).toContain('CONTRACT DE SERVICII')
    expect(html).toContain('ACORD DE PRELUCRARE A DATELOR')
  })

  it('fall back to informative defaults for missing configuration fields', () => {
    const anexa = renderAnexaHtml({ client: makeClient(), details: completeDetails, monthlyPriceFormatted: PRICE, provider: PROVIDER })
    expect(anexa).toContain('<td>150</td>')
    expect(anexa).toContain('<td>Niciunul</td>')
  })
})

describe('the AI module fragments', () => {
  it('are left out when moduleAddon lacks "VanaGreen AI"', () => {
    const { contract } = renderMarked({ ...completeDetails, moduleAddon: 'Tratări, Nexus' })
    expect(contract).not.toContain('[subprocesor-ai]')
    expect(contract).not.toContain('[transferuri-cu-ai]')
    expect(contract).toContain('[transferuri-fara-ai]')
  })

  it('are included when moduleAddon lists "VanaGreen AI"', () => {
    const { contract } = renderMarked({ ...completeDetails, moduleAddon: 'Tratări, VanaGreen AI' })
    expect(contract).toContain('[subprocesor-ai]')
    expect(contract).toContain('[transferuri-cu-ai]')
    expect(contract).not.toContain('[transferuri-fara-ai]')
  })
})

// The free month is on unless the client's details turn it off explicitly.
describe('areLunaGratuita', () => {
  const CONTRACT_KEYS = ['defTaxaInitiere', 'defLunaGratuita', 'clauza42', 'clauza43', 'clauza55', 'clauza131', 'clauza132', 'clauza135'] as const
  const ANEXA_KEYS = ['anexaSect3Titlu', 'anexaSect3Intro', 'anexaScadentaInitiere'] as const

  it('unset: every clause takes the free-month variant', () => {
    const { contract, anexa } = renderMarked(completeDetails)
    for (const key of CONTRACT_KEYS) expect(contract).toContain(`[cu:${key}]`)
    for (const key of ANEXA_KEYS) expect(anexa).toContain(`[cu:${key}]`)
    expect(contract + anexa).not.toContain('[fara:')
  })

  it('true: same as unset', () => {
    const unset = renderMarked(completeDetails)
    const explicit = renderMarked({ ...completeDetails, areLunaGratuita: true })
    expect(explicit).toEqual(unset)
  })

  it('false: every clause takes the other variant, and the labels around them stay', () => {
    const { contract, anexa } = renderMarked({ ...completeDetails, areLunaGratuita: false })
    for (const key of CONTRACT_KEYS) expect(contract).toContain(`[fara:${key}]`)
    for (const key of ANEXA_KEYS) expect(anexa).toContain(`[fara:${key}]`)
    expect(contract + anexa).not.toContain('[cu:')
    expect(contract).toContain('<strong class="label">4.2.</strong> [fara:clauza42]')
  })

  it('fills the three tokens a clause variant may use', () => {
    const fragments: ContractFragments = {
      ...MARKED_FRAGMENTS,
      cuLunaGratuita: { ...MARKED_FRAGMENTS.cuLunaGratuita, clauza43: '{{nrZileOnboarding}} | {{lunaGratuitaDurata}} | {{termenConfirmareContinuare}}' },
    }
    const html = renderContractHtml(
      { client: makeClient(), details: { ...completeDetails, nrZileOnboarding: '5' }, monthlyPriceFormatted: PRICE, provider: PROVIDER },
      DEFAULT_CONTRACT_TERMS,
      CONTRACT_TEMPLATE_BODIES['contract-saas'],
      fragments,
    )
    expect(html).toContain('5 | 1 lună | 7 zile calendaristice')
  })

  it('rejects a clause variant that uses any other token', () => {
    const fragments: ContractFragments = {
      ...MARKED_FRAGMENTS,
      cuLunaGratuita: { ...MARKED_FRAGMENTS.cuLunaGratuita, clauza43: '{{monthlyPrice}}' },
    }
    expect(() =>
      renderContractHtml({ client: makeClient(), details: completeDetails, monthlyPriceFormatted: PRICE, provider: PROVIDER }, DEFAULT_CONTRACT_TERMS, CONTRACT_TEMPLATE_BODIES['contract-saas'], fragments),
    ).toThrow(/Tokeni necunoscuți în șablon: monthlyPrice/)
  })
})

describe('renderActAditionalHtml', () => {
  const client = makeClient()
  const contractInfo = { nrContract: '001', dataContract: '4 iunie 2026' }
  const body = CONTRACT_TEMPLATE_BODIES['act-aditional']

  it('closes with Art. 3 and leaves the temporary section out when the change is permanent', () => {
    const html = renderActAditionalHtml(makeAddendum({ temporary: false }), client, contractInfo, PROVIDER, DEFAULT_CONTRACT_TERMS, body, MARKED_FRAGMENTS)
    expect(html).toContain('Art. 3. DISPOZIȚII FINALE')
    expect(html).not.toContain('[temporar')
  })

  it('inserts the temporary section, with the reversion note, and moves the closing article to Art. 4', () => {
    const addendum = makeAddendum({ number: 2, temporary: true, reversionNote: 'Revine la tariful vechi după 3 luni.' })
    const html = renderActAditionalHtml(addendum, client, contractInfo, PROVIDER, DEFAULT_CONTRACT_TERMS, body, MARKED_FRAGMENTS)
    expect(html).toContain('ACT ADIȚIONAL NR. 2')
    expect(html).toContain('[temporar: Revine la tariful vechi după 3 luni.]')
    expect(html).toContain('Art. 4. DISPOZIȚII FINALE')
  })

  it('HTML-escapes the notes typed into the addendum', () => {
    const html = renderActAditionalHtml(makeAddendum({ reason: '<b>motiv</b>' }), client, contractInfo, PROVIDER)
    expect(html).not.toContain('<b>motiv</b>')
    expect(html).toContain('&lt;b&gt;motiv&lt;/b&gt;')
  })
})

describe('the template engine', () => {
  const data = {
    client: makeClient(),
    details: { ...completeDetails, moduleAddon: 'VanaGreen AI' },
    monthlyPriceFormatted: PRICE,
    provider: PROVIDER,
  }

  it('renders the same HTML whether the default body is implied or passed in', () => {
    expect(renderContractHtml(data)).toBe(renderContractHtml(data, DEFAULT_CONTRACT_TERMS, CONTRACT_TEMPLATE_BODIES['contract-saas'], DEFAULT_CONTRACT_FRAGMENTS))
  })

  it('puts overridden commercial terms in the rendered HTML', () => {
    const body = '<p>{{termenScadenta}} / {{slaUptime}} / {{gratiePlata}}</p>'
    const html = renderContractHtml(data, { ...DEFAULT_CONTRACT_TERMS, termenScadenta: '5 zile', slaUptime: '99,5%' }, body)
    expect(html).toBe('<p>5 zile / 99,5% / 20 zile</p>')
  })

  it('renders from an edited body', () => {
    const html = renderContractHtml(data, DEFAULT_CONTRACT_TERMS, '<p>Contract {{nrContract}} pentru {{client.nume}}</p>')
    expect(html).toBe('<p>Contract 010 pentru Test Client SRL</p>')
  })

  it('throws on an unknown token in an edited body', () => {
    const brokenBody = CONTRACT_TEMPLATE_BODIES['contract-saas'].replace('{{monthlyPrice}}', '{{pretLunarTypo}}')
    expect(() => renderContractHtml(data, DEFAULT_CONTRACT_TERMS, brokenBody)).toThrow(/Tokeni necunoscuți în șablon: pretLunarTypo/)
  })

  it('HTML-escapes client-supplied values', () => {
    const hostile = { client: makeClient({ name: '<script>alert(1)</script> SRL' }), details: completeDetails, monthlyPriceFormatted: PRICE, provider: PROVIDER }
    for (const html of [renderContractHtml(hostile), renderAnexaHtml(hostile)]) {
      expect(html).not.toContain('<script>alert(1)</script>')
      expect(html).toContain('&lt;script&gt;')
    }
  })
})

// The em dash is allowed in one place only: the "nothing here" value of an optional field,
// alone in its table cell.
describe('no em dash in the sample texts', () => {
  const details: ContractDetails = {
    ...completeDetails,
    moduleAddon: 'VanaGreen AI',
    nrZileOnboarding: '5',
    operatoriGestiune: '2',
    operatoriTeren: '1',
    puncteLucru: '1',
    flux: 'Standard',
  }

  function withoutEmptyValueCells(html: string): string {
    return html.replace(/>—</g, '><')
  }

  it('contract and annex, with and without the free month', () => {
    for (const areLunaGratuita of [true, false]) {
      const data = { client: makeClient(), details: { ...details, areLunaGratuita }, monthlyPriceFormatted: PRICE, provider: PROVIDER }
      expect(withoutEmptyValueCells(renderContractHtml(data))).not.toContain('—')
      expect(withoutEmptyValueCells(renderAnexaHtml(data))).not.toContain('—')
    }
  })

  it('addendum', () => {
    const html = renderActAditionalHtml(makeAddendum({ temporary: true, reversionNote: 'Revine după 2 luni.' }), makeClient(), { nrContract: '010', dataContract: '1 august 2026' }, PROVIDER)
    expect(withoutEmptyValueCells(html)).not.toContain('—')
  })
})

describe('renderBlankHtml', () => {
  it('renders every template with dotted lines and no client data', () => {
    for (const key of CONTRACT_TEMPLATE_KEYS) {
      const html = renderBlankHtml(key, PROVIDER, DEFAULT_CONTRACT_TERMS, CONTRACT_TEMPLATE_BODIES[key], DEFAULT_CONTRACT_FRAGMENTS)
      expect(html).toContain('……………………')
      expect(html).not.toContain('{{')
      expect(html).not.toMatch(/undefined|null|NaN/)
    }
  })
})
