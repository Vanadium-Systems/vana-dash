import type { CompanyIdentity, Declarant, DeclarationLine } from './types.js'

// Generare XML pentru declarația 390 (recapitulativă VIES), OPANAF 705/11.03.2020
// (Vers. A1.0.0 din 18.03.2020 — cea curentă). Filtrează STRICT liniile eu_services — confirmat
// din schema reală (tip in L/T/A/P/S/R, toate intracomunitare) că non_eu_services nu are niciun
// cod de operațiune valid aici, niciodată. Toate achizițiile Hetzner/etc. sunt servicii → tip='S'
// (achiziții intracomunitare de servicii), niciodată 'A' (bunuri).

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

export interface D390BuildResult {
  xml: string
  totalBaseRon: number
}

/** `company.vatIntraCommunityCode` trebuie setat — apelantul (service) verifică înainte, fail-closed. */
export function buildD390Xml(period: string, lines: DeclarationLine[], company: CompanyIdentity, declarant: Declarant): D390BuildResult {
  const euLines = lines.filter((l) => l.reverseChargeType === 'eu_services')
  const [year, month] = period.split('-')
  const cui = company.vatIntraCommunityCode.toUpperCase().replace(/^RO/, '')

  const bazaS = Math.round(euLines.reduce((sum, l) => sum + l.baseRon, 0) * 100) / 100
  const totalPlataA = Math.trunc(bazaS)

  const operatii = euLines
    .map(
      (line) => `
    <operatie>
      <tip>S</tip>
      <tara>${esc(line.counterpartyCountry ?? '')}</tara>
      <codO>${esc(line.counterpartyVatId ?? '')}</codO>
      <denO>${esc(line.counterpartyName)}</denO>
      <baza>${money(line.baseRon)}</baza>
    </operatie>`,
    )
    .join('')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<declaratie390>
  <luna>${Number(month)}</luna>
  <an>${year}</an>
  <d_rec>0</d_rec>
  <nume_declar>${esc(declarant.lastName)}</nume_declar>
  <prenume_declar>${esc(declarant.firstName)}</prenume_declar>
  <functie_declar>${esc(declarant.role)}</functie_declar>
  <cui>${esc(cui)}</cui>
  <den>${esc(company.name)}</den>
  <adresa>${esc(company.address)}</adresa>
  <totalPlata_A>${totalPlataA}</totalPlata_A>
  <rezumat>
    <nr_pag>1</nr_pag>
    <nrOPI>${euLines.length}</nrOPI>
    <bazaL>0.00</bazaL>
    <bazaT>0.00</bazaT>
    <bazaA>0.00</bazaA>
    <bazaP>0.00</bazaP>
    <bazaS>${money(bazaS)}</bazaS>
    <bazaR>0.00</bazaR>
    <total_baza>${money(bazaS)}</total_baza>
  </rezumat>${operatii}
</declaratie390>
`

  return { xml, totalBaseRon: bazaS }
}
