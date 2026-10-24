import type { CompanyIdentity, Declarant, DeclarationLine } from './types.js'
import { buildNrEvid } from './nr-evid.js'
import { datasetsPacket, xmlText } from './xfa-pdf.js'

// D301 (special VAT return, reverse charge), universalCode D301_A2.0.0 from 2016, XML namespace v1.
// Format taken from a D301 that passed ANAF validation (form D301_XML_2017_260320.pdf):
// - section 4 (tip_operatie 4) holds every service bought under reverse charge, EU or not;
//   section 4.1 (tip_operatie 5) repeats the EU ones ("S4 = S4.1 + S4.2" in the structure)
// - totalPlata_A = INT(sum of every baza and tva, 4.1 included)
// Sections 1-3 (goods, new means of transport, excise goods) are out of scope.

const UNIVERSAL_CODE = 'D301_A2.0.4'

function money(value: number): string {
  return value.toFixed(2)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function dateParts(date: Date): [string, string, string] {
  return [String(date.getUTCDate()).padStart(2, '0'), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCFullYear())]
}

function latin(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export interface D301BuildResult {
  xml: string
  /** XFA datasets packet for the ANAF PDF form. */
  datasets: string
  totals: { baseRon: number; vatRon: number }
}

export function buildD301(period: string, lines: DeclarationLine[], company: CompanyIdentity, declarant: Declarant): D301BuildResult {
  const [year, month] = period.split('-')
  const luna = String(Number(month))
  const persInreg = company.vatIntraCommunityCode ? 2 : 1
  const nrEvid = buildNrEvid(period, false)

  const section4 = lines
  const section41 = lines.filter((l) => l.reverseChargeType === 'eu_services')
  const sum = (rows: DeclarationLine[], pick: (l: DeclarationLine) => number) => round2(rows.reduce((s, l) => s + pick(l), 0))
  const baza4 = sum(section4, (l) => l.baseRon)
  const tva4 = sum(section4, (l) => l.vatRon)
  const baza5 = sum(section41, (l) => l.baseRon)
  const tva5 = sum(section41, (l) => l.vatRon)
  const totalPlataA = Math.trunc(round2(baza4 + tva4 + baza5 + tva5))

  const name = latin(company.name)
  const address = latin(company.address)

  const sectiune = (tip: 4 | 5, l: DeclarationLine) => {
    const [d, m, y] = dateParts(l.issuedAt)
    return (
      `\n<sectiune tip_operatie="${tip}" nr_doc="${xmlText(l.documentNumber)}" data_doc="${d}.${m}.${y}"` +
      ` val_valuta="${money(l.amountForeign)}" tip_valuta="${xmlText(l.currency)}" curs_valutar="${l.fxRate.toFixed(4)}"` +
      ` baza="${money(l.baseRon)}" tva="${money(l.vatRon)}"/>`
    )
  }

  const xml =
    `<?xml version="1.0"?>\n` +
    `<declaratie301 d_rec="0" an="${year}" luna="${luna}" mijl_trans="0" temei="0" cif="${xmlText(company.cif)}"` +
    ` denumire="${xmlText(name)}" adresa="${xmlText(address)}" banca="${xmlText(latin(company.bank))}" cont="${xmlText(company.iban)}"` +
    ` pers_inreg="${persInreg}" nr_evid="${nrEvid}"\n` +
    ` baza1="0" tva1="0" baza2="0" tva2="0" baza3="0" tva3="0" baza4="${money(baza4)}" tva4="${money(tva4)}"` +
    ` baza5="${money(baza5)}" tva5="${money(tva5)}" totalPlata_A="${totalPlataA}"\n` +
    ` nume_declarant="${xmlText(latin(declarant.lastName))}" prenume_declarant="${xmlText(latin(declarant.firstName))}"` +
    ` functia_declarant="${xmlText(latin(declarant.role))}"\n` +
    ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="mfp:anaf:dgti:d301:declaratie:v1 D301.xsd"` +
    ` xmlns="mfp:anaf:dgti:d301:declaratie:v1">` +
    section4.map((l) => sectiune(4, l)).join('') +
    section41.map((l) => sectiune(5, l)).join('') +
    `\n</declaratie301>\n`

  const emptyRow = (n: number) =>
    `<rx${n}><TextField7/><NR_DOCUMENT/><DATA_DOCUMENT/><VALOARE_VALUTA/><TIP_VALUTA/><CURS_VALUTAR/><BAZA_IMPOZITARE/><TVA_DATORAT/></rx${n}>`
  const rows = (n: number, section: DeclarationLine[]) =>
    section.length === 0
      ? emptyRow(n)
      : section
          .map((l, i) => {
            const [d, m, y] = dateParts(l.issuedAt)
            return (
              `<rx${n}><TextField7>${i + 1}</TextField7><NR_DOCUMENT>${xmlText(l.documentNumber)}</NR_DOCUMENT>` +
              `<DATA_DOCUMENT>${d}/${m}/${y}</DATA_DOCUMENT><VALOARE_VALUTA>${money(l.amountForeign)}</VALOARE_VALUTA>` +
              `<TIP_VALUTA>${xmlText(l.currency)}</TIP_VALUTA><CURS_VALUTAR>${l.fxRate.toFixed(4)}</CURS_VALUTAR>` +
              `<BAZA_IMPOZITARE>${money(l.baseRon)}</BAZA_IMPOZITARE><TVA_DATORAT>${money(l.vatRon)}</TVA_DATORAT></rx${n}>`
            )
          })
          .join('')
  const head = (n: number) =>
    (n === 1 || n === 5 ? '' : '<th0 xfa:dataNode="dataGroup"/>') + '<th1 xfa:dataNode="dataGroup"/><th1 xfa:dataNode="dataGroup"/><th2 xfa:dataNode="dataGroup"/>'
  const table = (n: number, section: DeclarationLine[], baza: number, tva: number) =>
    `<Table${n}>${head(n)}${rows(n, section)}<rtotals><BAZA>${money(baza)}</BAZA><TVA>${money(tva)}</TVA></rtotals></Table${n}>`

  const datasets = datasetsPacket(
    `<form1><codF1><universalCode>${UNIVERSAL_CODE}</universalCode><codF2>301</codF2></codF1><body0>` +
      `<header><an_r>${year}</an_r><luna_r>${luna}</luna_r><mtn>0</mtn><d_rec>0</d_rec></header>` +
      `<temeilegal><literab>0</literab><literaa>0</literaa></temeilegal>` +
      `<sub1><cif>${xmlText(company.cif)}</cif><text_denumire>${xmlText(name)}</text_denumire><text_adresa>${xmlText(address)}</text_adresa>` +
      `<text_telefon/><text_fax/><text_email/><TIP_PERSOANA>${persInreg}</TIP_PERSOANA><banca>${xmlText(latin(company.bank))}</banca>` +
      `<cont>${xmlText(company.iban)}</cont><RO>RO</RO></sub1>` +
      `<sub2><nume>${xmlText(latin(declarant.lastName))}</nume><prenume>${xmlText(latin(declarant.firstName))}</prenume>` +
      `<functie>${xmlText(latin(declarant.role))}</functie></sub2>` +
      `<rezumat><baza1>0.00</baza1><tva1>0.00</tva1><baza2>0.00</baza2><tva2>0.00</tva2><baza3>0.00</baza3><tva3>0.00</tva3>` +
      `<baza41>${money(baza4)}</baza41><tva41>${money(tva4)}</tva41><baza42>${money(baza5)}</baza42><tva42>${money(tva5)}</tva42>` +
      `<Tbaza>${money(baza4 + baza5)}</Tbaza><Ttva>${money(tva4 + tva5)}</Ttva><totalPlata_A>${totalPlataA}</totalPlata_A>` +
      `<NR_JUSTIFICATIV>${nrEvid}</NR_JUSTIFICATIV></rezumat><subEnd><checkIfOneRowCompleted/></subEnd></body0>` +
      `<body1><main1>${table(1, [], 0, 0)}${table(2, [], 0, 0)}${table(3, [], 0, 0)}` +
      `${table(4, section4, baza4, tva4)}${table(5, section41, baza5, tva5)}</main1></body1></form1>`,
  )

  return { xml, datasets, totals: { baseRon: baza4, vatRon: tva4 } }
}
