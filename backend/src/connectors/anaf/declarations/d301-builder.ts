import type { CompanyIdentity, Declarant, DeclarationLine } from './types.js'
import { buildNrEvid } from './nr-evid.js'

// Generare XML pentru declarația 301 (decont special TVA, taxare inversă), UniversalCode
// D301_A1.0.0 (28/01/2013) — încă schema curentă, confirmat la research (nicio versiune mai
// nouă publicată de ANAF). Ramifică STRICT pe reverseChargeType: eu_services → tip_operatie=5
// (Secțiunea 4.1, art.150), non_eu_services → tip_operatie=4 (Secțiunea 4, FĂRĂ preluare la 4.1).
// Secțiunile 1-3 (bunuri/mijloace transport/produse accizabile) nu sunt în scope — vana-dash
// gestionează doar achiziții de servicii reverse-charge (Hetzner/Cloudflare etc.).

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function money(value: number): string {
  return value.toFixed(2)
}

function ddmmyyyy(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, '0')
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${d}.${m}.${date.getUTCFullYear()}`
}

const TIP_OPERATIE: Record<DeclarationLine['reverseChargeType'], 4 | 5> = {
  non_eu_services: 4,
  eu_services: 5,
}

export interface D301BuildResult {
  xml: string
  totals: { baseRon: number; vatRon: number }
}

/** `mijlTrans` e mereu false — vana-dash nu tratează achiziții de mijloace de transport noi (no bloat). */
export function buildD301Xml(
  period: string,
  lines: DeclarationLine[],
  company: CompanyIdentity,
  declarant: Declarant,
): D301BuildResult {
  const persInreg = company.vatIntraCommunityCode ? 2 : 1
  const nrEvid = buildNrEvid(period, false)

  const bucket = { 4: { baza: 0, tva: 0 }, 5: { baza: 0, tva: 0 } } as Record<4 | 5, { baza: number; tva: number }>
  for (const line of lines) {
    const tip = TIP_OPERATIE[line.reverseChargeType]
    bucket[tip].baza += line.baseRon
    bucket[tip].tva += line.vatRon
  }
  const baza4 = Math.round(bucket[4].baza * 100) / 100
  const tva4 = Math.round(bucket[4].tva * 100) / 100
  const baza5 = Math.round(bucket[5].baza * 100) / 100
  const tva5 = Math.round(bucket[5].tva * 100) / 100
  const totalPlataA = Math.trunc(baza4 + baza5 + tva4 + tva5)

  const sectiuni = lines
    .map((line) => {
      const tip = TIP_OPERATIE[line.reverseChargeType]
      return `
  <sectiune>
    <tip_operatie>${tip}</tip_operatie>
    <nr_doc>${esc(line.documentNumber)}</nr_doc>
    <data_doc>${ddmmyyyy(line.issuedAt)}</data_doc>
    <val_valuta>${money(line.amountForeign)}</val_valuta>
    <tip_valuta>${esc(line.currency)}</tip_valuta>
    <curs_valutar>${line.fxRate.toFixed(4)}</curs_valutar>
    <baza>${money(line.baseRon)}</baza>
    <tva>${money(line.vatRon)}</tva>
  </sectiune>`
    })
    .join('')

  const [year, month] = period.split('-')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<declaratie301>
  <luna>${Number(month)}</luna>
  <an>${year}</an>
  <d_rec>0</d_rec>
  <mijl_trans>0</mijl_trans>
  <cif>${esc(company.cif)}</cif>
  <denumire>${esc(company.name)}</denumire>
  <adresa>${esc(company.address)}</adresa>
  <banca>${esc(company.bank)}</banca>
  <cont>${esc(company.iban)}</cont>
  <pers_inreg>${persInreg}</pers_inreg>
  <nr_evid>${nrEvid}</nr_evid>
  <baza1>0.00</baza1>
  <tva1>0.00</tva1>
  <baza2>0.00</baza2>
  <tva2>0.00</tva2>
  <baza3>0.00</baza3>
  <tva3>0.00</tva3>
  <baza4>${money(baza4)}</baza4>
  <tva4>${money(tva4)}</tva4>
  <baza5>${money(baza5)}</baza5>
  <tva5>${money(tva5)}</tva5>
  <totalPlata_A>${totalPlataA}</totalPlata_A>
  <nume_declarant>${esc(declarant.lastName)}</nume_declarant>
  <prenume_declarant>${esc(declarant.firstName)}</prenume_declarant>
  <functia_declarant>${esc(declarant.role)}</functia_declarant>${sectiuni}
</declaratie301>
`

  return { xml, totals: { baseRon: baza4 + baza5, vatRon: tva4 + tva5 } }
}
