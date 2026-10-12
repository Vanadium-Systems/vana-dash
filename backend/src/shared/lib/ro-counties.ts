// Maps a county name (free text, `billing_clients.county`) to its ISO 3166-2:RO code, which
// CIUS-RO requires in CountrySubentity (BT-54) for any buyer in Romania (BR-RO-110). ANAF
// rejects the invoice without it.

const COUNTY_CODES: Record<string, string> = {
  ALBA: 'AB',
  ARAD: 'AR',
  ARGES: 'AG',
  BACAU: 'BC',
  BIHOR: 'BH',
  'BISTRITA-NASAUD': 'BN',
  BISTRITANASAUD: 'BN',
  BOTOSANI: 'BT',
  BRAILA: 'BR',
  BRASOV: 'BV',
  BUCURESTI: 'B',
  BUZAU: 'BZ',
  CALARASI: 'CL',
  'CARAS-SEVERIN': 'CS',
  CARASSEVERIN: 'CS',
  CLUJ: 'CJ',
  CONSTANTA: 'CT',
  COVASNA: 'CV',
  DAMBOVITA: 'DB',
  DOLJ: 'DJ',
  GALATI: 'GL',
  GIURGIU: 'GR',
  GORJ: 'GJ',
  HARGHITA: 'HR',
  HUNEDOARA: 'HD',
  IALOMITA: 'IL',
  IASI: 'IS',
  ILFOV: 'IF',
  MARAMURES: 'MM',
  MEHEDINTI: 'MH',
  MURES: 'MS',
  NEAMT: 'NT',
  OLT: 'OT',
  PRAHOVA: 'PH',
  SALAJ: 'SJ',
  'SATU MARE': 'SM',
  SATUMARE: 'SM',
  SIBIU: 'SB',
  SUCEAVA: 'SV',
  TELEORMAN: 'TR',
  TIMIS: 'TM',
  TULCEA: 'TL',
  VASLUI: 'VS',
  VALCEA: 'VL',
  VRANCEA: 'VN',
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .trim()
    .replace(/^MUNICIPIUL\s+/, '')
    .replace(/^JUDETUL\s+/, '')
}

/** 'Brasov' → 'RO-BV', 'Bucuresti'/'București' → 'RO-B'. Acceptă și cod deja formatat
 *  ('RO-BV', 'BV'). Returnează undefined dacă textul nu se potrivește cu niciun județ. */
export function countyNameToIsoCode(county: string | null | undefined): string | undefined {
  if (!county) return undefined
  const normalized = normalize(county)
  if (/^RO-[A-Z]{1,2}$/.test(county.toUpperCase())) return county.toUpperCase()
  const direct = COUNTY_CODES[normalized]
  if (direct) return `RO-${direct}`
  if (Object.values(COUNTY_CODES).includes(normalized)) return `RO-${normalized}`
  return undefined
}

const SECTOR_RE = /sector(?:ul)?\s*(\d)/i

/** Pulls the sector out of free text ("Sector 1", "SECTORUL2", "Sector 3 Mun. București") in
 *  the exact form ANAF wants in BT-52 (city) when the county is RO-B (rule BR-RO-100). It
 *  searches the text instead of asking for an exact match, so it also works on a full address. */
export function extractBucharestSectorCode(text: string | null | undefined): string | undefined {
  if (!text) return undefined
  const match = text.match(SECTOR_RE)
  if (!match) return undefined
  const n = Number(match[1])
  return n >= 1 && n <= 6 ? `SECTOR${n}` : undefined
}
