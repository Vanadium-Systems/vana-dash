// Company lookup at ANAF by tax id: a public endpoint, no authentication. The real path is
// `api/PlatitorTvaRest/v9/tva`, not the `PlatitorTvaRest/api/.../tva` form quoted in places
// online. It fills in a billing client (name, address, county), because ANAF rejects an
// invoice whose buyer data is wrong or incomplete.
import { normalizeCui } from './cui-validator.js'
import { countyNameToIsoCode, extractBucharestSectorCode } from './ro-counties.js'
import { tr } from './i18n.js'

const ANAF_TVA_URL = 'https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva'
const FETCH_TIMEOUT_MS = 5_000

export interface AnafCompanyInfo {
  name: string
  address: { street: string | null; locality: string | null; county: string | null }
  isVatPayer: boolean
  stare: 'activ' | 'inactiv' | 'radiat'
}

/** Exportat pt. test unitar. */
export interface AnafFoundEntry {
  date_generale?: { cui?: number; denumire?: string }
  inregistrare_scop_Tva?: { scpTVA?: boolean }
  stare_inactiv?: { statusInactivi?: boolean; dataRadiere?: string }
  adresa_sediu_social?: {
    sdenumire_Strada?: string
    snumar_Strada?: string
    sdenumire_Localitate?: string
    sdenumire_Judet?: string
  }
}

interface AnafTvaResponse {
  found?: AnafFoundEntry[]
  notFound?: number[]
}

function nonEmpty(value: string | undefined | null): string | null {
  return value && value.trim().length > 0 ? value.trim() : null
}

/** Exportat pt. test unitar. */
export function mapStare(stareInactiv: AnafFoundEntry['stare_inactiv']): AnafCompanyInfo['stare'] {
  if (nonEmpty(stareInactiv?.dataRadiere)) return 'radiat'
  if (stareInactiv?.statusInactivi === true) return 'inactiv'
  return 'activ'
}

/** Exportat pt. test unitar. */
export function mapEntry(entry: AnafFoundEntry): AnafCompanyInfo {
  const name = nonEmpty(entry.date_generale?.denumire)
  if (!name) throw new Error(tr('errors.anaf.lookupNoName'))
  const adresa = entry.adresa_sediu_social
  const street = nonEmpty([adresa?.sdenumire_Strada, adresa?.snumar_Strada].filter(Boolean).join(' '))
  const county = nonEmpty(adresa?.sdenumire_Judet)
  const rawLocality = nonEmpty(adresa?.sdenumire_Localitate)
  // Bucharest (RO-B): on an invoice ANAF wants the city as SECTOR1..SECTOR6 (BR-RO-100).
  // Normalized here, so the form is filled with the right value instead of failing at issue.
  // The address is the fallback when the city does not name the sector.
  const locality =
    countyNameToIsoCode(county) === 'RO-B'
      ? (extractBucharestSectorCode(rawLocality) ?? extractBucharestSectorCode(street) ?? rawLocality)
      : rawLocality
  return {
    name,
    address: { street, locality, county },
    isVatPayer: entry.inregistrare_scop_Tva?.scpTVA === true,
    stare: mapStare(entry.stare_inactiv),
  }
}

/** Caută o singură firmă după CIF. Validează cifra de control local înainte de request. */
export async function lookupCompanyByCui(rawCif: string): Promise<AnafCompanyInfo> {
  const cui = normalizeCui(rawCif)
  if (!cui) throw new Error(tr('errors.anaf.cifInvalid'))

  const today = new Date().toISOString().slice(0, 10)
  let res: Response
  try {
    res = await fetch(ANAF_TVA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ cui: Number(cui), data: today }]),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (err) {
    throw new Error(tr('errors.anaf.unreachable', { err: String(err) }))
  }
  if (!res.ok) throw new Error(tr('errors.anaf.http', { status: res.status }))

  const body = (await res.json()) as AnafTvaResponse
  const entry = body.found?.[0]
  if (!entry) throw new Error(tr('errors.anaf.noRecord', { cui }))
  return mapEntry(entry)
}
