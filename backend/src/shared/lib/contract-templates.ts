import type { billingClients } from '../db/schema/billing-clients.js'
import type { ContractAddendum } from '../db/schema/contract-addenda.js'
import type { ContractDetails } from '../../modules/contracts/schema.js'
import { config } from '../config.js'
import {
  CONTRACT_TEMPLATE_BODIES,
  CONTRACT_TEMPLATE_KEYS,
  CONTRACT_TEMPLATE_PLACEHOLDERS,
  DEFAULT_CONTRACT_FRAGMENTS,
  type ContractFragments,
  type ContractTemplateKey,
} from './contract-template-bodies.js'

// Renders the contract, the price annex and the addendum from the token templates in
// contract-template-bodies.ts. The same bodies are seeded into the database (contract_templates),
// where an installation edits them; the copy here is what "restore" brings back.

type BillingClientRow = typeof billingClients.$inferSelect

export interface ContractRenderData {
  client: BillingClientRow
  details: ContractDetails
  monthlyPriceFormatted: string
}

const VANADIUM = {
  nume: config.company.name,
  cui: config.company.cif,
  nrRegCom: config.company.regCom,
  // config.company keeps the city and the address apart (the UBL XML needs them so); a
  // contract writes them as one line, city first.
  adresa: `${config.company.city}, ${config.company.address}`,
  reprezentant: config.company.representative,
  email: config.company.email,
  telefon: config.company.phone,
}

// Commercial terms shared by every contract. These are the defaults; an installation
// overrides them from the UI (dashboard_config['contract.terms'], see
// modules/contracts/templates-service.ts).
export const DEFAULT_CONTRACT_TERMS = {
  penalitateIntarziere: '0,2% / zi',
  termenScadenta: '10 zile',
  gratiePlata: '20 zile',
  preavizReziliere: '30 zile',
  termenConfirmareContinuare: '7 zile calendaristice',
  lunaGratuitaDurata: '1 lună',
  referralReducere: '30%',
  referralDurata: '1 lună',
  referralPlafon: '90%',
  slaUptime: '99,9%',
  slaMentenanta: 'Duminică, 02:00–06:00 EET (cu notificare 48h înainte)',
  slaP1: '4 ore lucrătoare',
  slaP2: '24 ore lucrătoare',
} as const

export type ContractTerms = { [K in keyof typeof DEFAULT_CONTRACT_TERMS]: string }

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const AI_ASSISTANT_ADDON_LABEL = 'VanaGreen AI'

export function hasAiAssistant(moduleAddon: string): boolean {
  return moduleAddon.split(',').map((label) => label.trim()).includes(AI_ASSISTANT_ADDON_LABEL)
}

const REQUIRED_FIELD_LABELS: Record<string, string> = {
  contactName: 'Reprezentant client',
  contactTitle: 'Funcție reprezentant',
  phone: 'Telefon client',
  contractPlan: 'Plan',
  subscriptionPrice: 'Tarif abonament (lei sau eur)',
  nrContract: 'Număr contract',
  dataContract: 'Data contract',
  taxaInitiere: 'Taxă de inițiere',
  facturareTip: 'Ciclu de facturare',
}

/** Aruncă cu lista EXACTĂ de câmpuri lipsă: eroare 400 clară în FE, nu PDF cu goluri. */
export function assertContractDataComplete(client: BillingClientRow, details: ContractDetails): void {
  const missing: string[] = []
  if (!client.contactName) missing.push(REQUIRED_FIELD_LABELS.contactName!)
  if (!client.contactTitle) missing.push(REQUIRED_FIELD_LABELS.contactTitle!)
  if (!client.phone) missing.push(REQUIRED_FIELD_LABELS.phone!)
  if (!client.contractPlan) missing.push(REQUIRED_FIELD_LABELS.contractPlan!)
  const hasPrice =
    (client.subscriptionPriceCurrency === 'eur' && client.subscriptionPriceEur) ||
    (client.subscriptionPriceCurrency === 'lei' && client.subscriptionPriceLei)
  if (!hasPrice) missing.push(REQUIRED_FIELD_LABELS.subscriptionPrice!)
  if (!details.nrContract) missing.push(REQUIRED_FIELD_LABELS.nrContract!)
  if (!details.dataContract) missing.push(REQUIRED_FIELD_LABELS.dataContract!)
  if (!details.taxaInitiere) missing.push(REQUIRED_FIELD_LABELS.taxaInitiere!)
  if (!details.facturareTip) missing.push(REQUIRED_FIELD_LABELS.facturareTip!)

  if (missing.length > 0) {
    throw new Error(`Date lipsă pentru generarea documentului: ${missing.join(', ')}`)
  }
}

// `subscriptionPriceLei/Eur` e prețul FACTURAT PE CICLU: pt. `billingCycle='annual'` (ex.
// un client cu 400 EUR/an), asta e suma anuală, nu lunară. Bug găsit 2026-08-01 la
// import-ul contractelor semnate în prod (exact același bug ca la MRR, vezi
// `getCurrentMrr`/`financial-aggregation.ts`); fără normalizare, un contract nou generat pt.
// un client anual ar afișa greșit "400 EUR/lună" în loc de "33,33 EUR/lună (echivalent 400
// EUR/an, facturat anual)".
export function formatMonthlyPrice(client: BillingClientRow): string {
  const annual = client.billingCycle === 'annual'
  if (client.subscriptionPriceCurrency === 'eur' && client.subscriptionPriceEur) {
    const total = Number(client.subscriptionPriceEur)
    if (!annual) return `${total} EUR/lună`
    const monthly = (total / 12).toFixed(2).replace(/\.00$/, '').replace('.', ',')
    return `${monthly} EUR/lună (echivalent ${total} EUR/an, facturat anual)`
  }
  if (client.subscriptionPriceLei) {
    const total = Number(client.subscriptionPriceLei)
    if (!annual) return `${total} RON/lună`
    const monthly = (total / 12).toFixed(2).replace(/\.00$/, '').replace('.', ',')
    return `${monthly} RON/lună (echivalent ${total} RON/an, facturat anual)`
  }
  return '—'
}

// ─── Defaults pt. câmpurile informative (Configurația, nu blochează generarea dacă lipsesc,
// spre deosebire de REQUIRED_FIELD_LABELS de mai sus) ──────────────────────────────────────────

type ContractDetailsWithDefaults = Required<
  Pick<
    ContractDetails,
    | 'nrContract'
    | 'dataContract'
    | 'taxaInitiere'
    | 'nrZileOnboarding'
    | 'facturareTip'
    | 'operatoriGestiune'
    | 'operatoriTeren'
    | 'puncteLucru'
    | 'documenteIncluse'
    | 'flux'
    | 'moduleAddon'
    | 'conditiiSpeciale'
  >
> &
  ContractDetails

export function withDefaults(details: ContractDetails): ContractDetailsWithDefaults {
  return {
    ...details,
    nrContract: details.nrContract ?? '',
    dataContract: details.dataContract ?? '',
    taxaInitiere: details.taxaInitiere ?? '',
    // Singurul câmp din grupul ăsta interpolat INLINE într-o propoziție (Art. 4.3), nu izolat
    // într-un <td> ca restul; „—" gol acolo arăta stricat: „...în termen de — Zile Lucrătoare...".
    // Default „7" (Stefan, 2026-09-21: "7 zile onboarding bydef e chill"), nu placeholder N/A.
    nrZileOnboarding: details.nrZileOnboarding ?? '7',
    facturareTip: details.facturareTip ?? '',
    operatoriGestiune: details.operatoriGestiune ?? '—',
    operatoriTeren: details.operatoriTeren ?? '—',
    puncteLucru: details.puncteLucru ?? '—',
    documenteIncluse: details.documenteIncluse ?? '150',
    flux: details.flux ?? '—',
    moduleAddon: details.moduleAddon ?? 'Niciunul',
    conditiiSpeciale: details.conditiiSpeciale ?? '(fără condiții speciale)',
  }
}

// ─── Motorul de șabloane: înlocuire {{token}}, necunoscut = eroare tare ─────────────────────

const TOKEN_RE = /\{\{([a-zA-Z0-9._]+)\}\}/g

/** Corpurile de șablon sunt HTML de încredere (editate doar de Stefan autentificat); valorile
 *  per-client injectate prin tokeni trec TOATE prin esc() în builder-ele de mai jos. */
export function renderTemplateBody(bodyHtml: string, tokens: Record<string, string>): string {
  const unknown = new Set<string>()
  const html = bodyHtml.replace(TOKEN_RE, (_match, name: string) => {
    const value = tokens[name]
    if (value === undefined) {
      unknown.add(name)
      return ''
    }
    return value
  })
  if (unknown.size > 0) {
    throw new Error(`Tokeni necunoscuți în șablon: ${[...unknown].join(', ')}`)
  }
  return html
}

interface ClientTokensInput {
  client: Pick<BillingClientRow, 'name' | 'address' | 'regCom' | 'cif' | 'contactName' | 'contactTitle'>
  terms: ContractTerms
}

function baseTokens({ client, terms }: ClientTokensInput): Record<string, string> {
  return {
    'prestator.nume': esc(VANADIUM.nume),
    'prestator.cui': esc(VANADIUM.cui),
    'prestator.nrRegCom': esc(VANADIUM.nrRegCom),
    'prestator.adresa': esc(VANADIUM.adresa),
    'prestator.reprezentant': esc(VANADIUM.reprezentant),
    'prestator.email': esc(VANADIUM.email),
    'prestator.telefon': esc(VANADIUM.telefon),
    'client.nume': esc(client.name),
    'client.adresa': esc(client.address),
    'client.regCom': esc(client.regCom ?? '—'),
    'client.cif': esc(client.cif),
    'client.reprezentant': esc(client.contactName ?? '—'),
    'client.functie': esc(client.contactTitle ?? '—'),
    termenScadenta: esc(terms.termenScadenta),
    penalitateIntarziere: esc(terms.penalitateIntarziere),
    gratiePlata: esc(terms.gratiePlata),
    lunaGratuitaDurata: esc(terms.lunaGratuitaDurata),
    referralReducere: esc(terms.referralReducere),
    referralDurata: esc(terms.referralDurata),
    referralPlafon: esc(terms.referralPlafon),
    slaUptime: esc(terms.slaUptime),
    slaMentenanta: esc(terms.slaMentenanta),
    slaP1: esc(terms.slaP1),
    slaP2: esc(terms.slaP2),
    termenConfirmareContinuare: esc(terms.termenConfirmareContinuare),
    preavizReziliere: esc(terms.preavizReziliere),
  }
}

/**
 * The free month is not one optional section: it changes the wording of several clauses in the
 * contract and of one section in the annex. `hasLunaGratuita` (true when unset) picks the variant
 * for each of them; the surrounding numbering stays in the body.
 */
function lunaGratuitaTokens(hasLunaGratuita: boolean, terms: ContractTerms, nrZileOnboarding: string, fragments: ContractFragments): Record<string, string> {
  // The clause variants are templates themselves; these three tokens are the only ones they
  // can use.
  const inner = {
    lunaGratuitaDurata: esc(terms.lunaGratuitaDurata),
    termenConfirmareContinuare: esc(terms.termenConfirmareContinuare),
    nrZileOnboarding,
  }
  const variant = hasLunaGratuita ? fragments.cuLunaGratuita : fragments.faraLunaGratuita
  return Object.fromEntries(Object.entries(variant).map(([key, text]) => [key, renderTemplateBody(text, inner)]))
}

function saasTokens(data: ContractRenderData, terms: ContractTerms, fragments: ContractFragments): Record<string, string> {
  const d = withDefaults(data.details)
  const aiActive = hasAiAssistant(d.moduleAddon)
  return {
    ...baseTokens({ client: data.client, terms }),
    nrContract: esc(d.nrContract),
    dataContract: esc(d.dataContract),
    monthlyPrice: esc(data.monthlyPriceFormatted),
    taxaInitiere: esc(d.taxaInitiere),
    nrZileOnboarding: esc(d.nrZileOnboarding),
    facturareTip: esc(d.facturareTip),
    subprocesorAiExtra: aiActive ? fragments.subprocesorAiExtra : '',
    paragrafTransferuri: aiActive ? fragments.paragrafTransferuriCuAi : fragments.paragrafTransferuriFaraAi,
    ...lunaGratuitaTokens(d.areLunaGratuita !== false, terms, esc(d.nrZileOnboarding), fragments),
  }
}

function anexaTokens(data: ContractRenderData, terms: ContractTerms, fragments: ContractFragments): Record<string, string> {
  const d = withDefaults(data.details)
  return {
    ...baseTokens({ client: data.client, terms }),
    nrContract: esc(d.nrContract),
    dataContract: esc(d.dataContract),
    monthlyPrice: esc(data.monthlyPriceFormatted),
    taxaInitiere: esc(d.taxaInitiere),
    facturareTip: esc(d.facturareTip),
    operatoriGestiune: esc(d.operatoriGestiune),
    operatoriTeren: esc(d.operatoriTeren),
    puncteLucru: esc(d.puncteLucru),
    documenteIncluse: esc(d.documenteIncluse),
    flux: esc(d.flux),
    moduleAddon: esc(d.moduleAddon),
    conditiiSpeciale: esc(d.conditiiSpeciale),
    ...lunaGratuitaTokens(d.areLunaGratuita !== false, terms, esc(d.nrZileOnboarding), fragments),
  }
}

function actTokens(
  addendum: ContractAddendum,
  client: BillingClientRow,
  contractInfo: { nrContract: string; dataContract: string },
  terms: ContractTerms,
  fragments: ContractFragments,
): Record<string, string> {
  const temporary = addendum.temporary === true
  const tokens: Record<string, string> = {
    ...baseTokens({ client, terms }),
    nrContract: esc(contractInfo.nrContract),
    dataContract: esc(contractInfo.dataContract),
    actNumar: esc(String(addendum.number)),
    actDataEmitere: esc(addendum.issuedAt),
    tarifAnterior: esc(addendum.oldPriceNote),
    tarifNou: esc(addendum.newPriceNote),
    motivModificare: esc(addendum.reason),
    dataIntrareVigoare: esc(addendum.effectiveDateNote),
    notaRevenire: esc(addendum.reversionNote ?? ''),
    nrArticolFinalAct: temporary ? '4' : '3',
  }
  tokens.sectiuneTemporaraAct = temporary ? renderTemplateBody(fragments.sectiuneTemporaraAct, tokens) : ''
  return tokens
}

// ─── Randarea publică: corpul vine din DB (modules/contracts) cu fallback pe canonicalul de
// aici; semnăturile rămân cele originale ca testele și apelantii să nu se schimbe. ────────────

export function renderContractHtml(
  data: ContractRenderData,
  terms: ContractTerms = DEFAULT_CONTRACT_TERMS,
  bodyHtml: string = CONTRACT_TEMPLATE_BODIES['contract-saas'],
  fragments: ContractFragments = DEFAULT_CONTRACT_FRAGMENTS,
): string {
  return renderTemplateBody(bodyHtml, saasTokens(data, terms, fragments))
}

export function renderAnexaHtml(
  data: ContractRenderData,
  terms: ContractTerms = DEFAULT_CONTRACT_TERMS,
  bodyHtml: string = CONTRACT_TEMPLATE_BODIES['anexa-preturi'],
  fragments: ContractFragments = DEFAULT_CONTRACT_FRAGMENTS,
): string {
  return renderTemplateBody(bodyHtml, anexaTokens(data, terms, fragments))
}

export function renderActAditionalHtml(
  addendum: ContractAddendum,
  client: BillingClientRow,
  contractInfo: { nrContract: string; dataContract: string },
  terms: ContractTerms = DEFAULT_CONTRACT_TERMS,
  bodyHtml: string = CONTRACT_TEMPLATE_BODIES['act-aditional'],
  fragments: ContractFragments = DEFAULT_CONTRACT_FRAGMENTS,
): string {
  return renderTemplateBody(bodyHtml, actTokens(addendum, client, contractInfo, terms, fragments))
}

export { CONTRACT_TEMPLATE_BODIES, CONTRACT_TEMPLATE_KEYS, CONTRACT_TEMPLATE_PLACEHOLDERS, DEFAULT_CONTRACT_FRAGMENTS }
export type { ContractFragments, ContractTemplateKey }
