import { tr } from '../shared/lib/i18n.js'
import { ro } from './ro/index.js'
import type { CountryPack } from './types.js'

// Everything that follows one country's law or institutions lives in its pack, the way platform
// code lives in connectors/. No `country === 'RO'` outside this folder.

const PACKS: Record<string, CountryPack> = { RO: ro }

export function getCountryPack(code: string): CountryPack {
  const pack = PACKS[code]
  if (!pack) throw new Error(tr('errors.company.countryUnsupported', { country: code }))
  return pack
}

export function availableCountries(): string[] {
  return Object.keys(PACKS)
}
