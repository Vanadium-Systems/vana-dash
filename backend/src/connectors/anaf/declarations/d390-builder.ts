import type { CompanyIdentity, Declarant, DeclarationLine } from './types.js'
import { datasetsPacket, xmlText } from './xfa-pdf.js'

// D390 (VIES recapitulative), OPANAF 705/2020, XML namespace v3. Format taken from a D390 that
// passed ANAF validation (form D390_XML_2020_300424.pdf, universalCode D390_A1.0.11):
// - amounts are whole lei, one `operatie` per partner (country + VAT code + type); the form
//   rejects the same partner twice, so invoices are summed per partner first
// - totalPlata_A = number of partners + every base (the form's own control sum)
// - only eu_services lines, always tip S: every purchase handled here is a service.

const UNIVERSAL_CODE = 'D390_A1.0.11'

/** The form turns diacritics into plain letters on exit from each field; prefilled data skips that. */
function latin(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function vatCodeWithoutCountry(vatId: string): string {
  return vatId.toUpperCase().replace(/\s/g, '').replace(/^[A-Z]{2}(?=\d)/, '')
}

export interface D390Partner {
  country: string
  vatCode: string
  name: string
  baseRon: number
}

export interface D390BuildResult {
  xml: string
  /** XFA datasets packet for the ANAF PDF form. */
  datasets: string
  partners: D390Partner[]
  totalBaseRon: number
}

/** `company.vatIntraCommunityCode` must be set; the service checks before calling. */
export function buildD390(period: string, lines: DeclarationLine[], company: CompanyIdentity, declarant: Declarant): D390BuildResult {
  const [year, month] = period.split('-')
  const luna = month!.padStart(2, '0')
  const cui = company.vatIntraCommunityCode.toUpperCase().replace(/^RO/, '')

  const byPartner = new Map<string, { country: string; vatCode: string; name: string; base: number }>()
  for (const line of lines) {
    if (line.reverseChargeType !== 'eu_services') continue
    const country = (line.counterpartyCountry ?? '').toUpperCase()
    const vatCode = vatCodeWithoutCountry(line.counterpartyVatId ?? '')
    const key = `${country}|${vatCode}`
    const partner = byPartner.get(key) ?? { country, vatCode, name: latin(line.counterpartyName).toUpperCase(), base: 0 }
    partner.base += line.baseRon
    byPartner.set(key, partner)
  }
  const partners: D390Partner[] = [...byPartner.values()].map((p) => ({
    country: p.country,
    vatCode: p.vatCode,
    name: p.name,
    baseRon: Math.round(p.base),
  }))

  const bazaS = partners.reduce((sum, p) => sum + p.baseRon, 0)
  const totalPlataA = partners.length + bazaS
  const name = latin(company.name)
  const address = latin(company.address)

  const operatii = partners
    .map((p) => `\n\t<operatie tip="S" tara="${xmlText(p.country)}" codO="${xmlText(p.vatCode)}" denO="${xmlText(p.name)}" baza="${p.baseRon}" />`)
    .join('')

  const xml =
    `<?xml version="1.0"?>\n` +
    `<declaratie390 luna="${luna}" an="${year}" d_rec="0" nume_declar="${xmlText(latin(declarant.lastName))}"` +
    ` prenume_declar="${xmlText(latin(declarant.firstName))}" functie_declar="${xmlText(latin(declarant.role))}"` +
    ` cui="${xmlText(cui)}" den="${xmlText(name)}" adresa="${xmlText(address)}" totalPlata_A="${totalPlataA}"` +
    ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="mfp:anaf:dgti:d390:declaratie:v3 D390.xsd"` +
    ` xmlns="mfp:anaf:dgti:d390:declaratie:v3">\n` +
    `\t<rezumat nr_pag="1" nrOPI="${partners.length}" bazaL="0" bazaT="0" bazaA="0" bazaP="0" bazaS="${bazaS}" bazaR="0" total_baza="${bazaS}" />` +
    `${operatii}\n</declaratie390>\n`

  const rows = partners
    .map(
      (p, i) =>
        `<OP2><seq>${i + 1}</seq><TIP_OP>S</TIP_OP><TARA>${xmlText(p.country)}</TARA><COD_OP>${xmlText(p.vatCode)}</COD_OP>` +
        `<DEN_OP>${xmlText(p.name)}</DEN_OP><BAZA>${p.baseRon}</BAZA></OP2>`,
    )
    .join('')

  const datasets = datasetsPacket(
    `<form1><codF1><universalCode>${UNIVERSAL_CODE}</universalCode></codF1><body1><HEADER xfa:dataNode="dataGroup"/>` +
      `<dd1><d_rec>0</d_rec></dd1><dd2><luna_r>${luna}</luna_r><an_r>${year}</an_r></dd2>` +
      `<dd3><cif>${xmlText(cui)}</cif><denumire>${xmlText(name)}</denumire><adresa>${xmlText(address)}</adresa><telefon/><fax/><eMail/></dd3>` +
      `<dd4><totalPlata_A>${totalPlataA}</totalPlata_A><TOTAL_PAGINI/><TOTAL_OPERATORI>${partners.length}</TOTAL_OPERATORI>` +
      `<SUMA_L>0</SUMA_L><SUMA_T>0</SUMA_T><SUMA_A>0</SUMA_A><SUMA_P>0</SUMA_P><SUMA_S>${bazaS}</SUMA_S><SUMA_R>0</SUMA_R></dd4>` +
      `<dd5><numeP>${xmlText(latin(declarant.lastName))}</numeP><prenP>${xmlText(latin(declarant.firstName))}</prenP>` +
      `<functiaP>${xmlText(latin(declarant.role))}</functiaP></dd5><dd6><numeFisier/></dd6></body1>` +
      `<body3><dd1 xfa:dataNode="dataGroup"/><dd2><seq>1.00000000</seq><TARA1/><COD_OP1/></dd2><dd4 xfa:dataNode="dataGroup"/></body3>` +
      `<body4><dd1 xfa:dataNode="dataGroup"/><dd2><seq/><TARA1/><COD_OP1/><TARA2/><COD_OP2/><motiv/></dd2></body4>` +
      `<body2><dd1><OP1>${rows}</OP1><TG><TOTAL_BAZA>${bazaS}</TOTAL_BAZA></TG><BUTOANE><unicitate/></BUTOANE></dd1></body2></form1>`,
  )

  return { xml, datasets, partners, totalBaseRon: bazaS }
}
