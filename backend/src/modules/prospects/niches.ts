// Prospect niches mapped from CAEN Rev. 2 / Rev. 2025 prefixes (kept in sync with harvey-ro).
// `altele` matches any prospect with a non-empty CAEN code that does not belong to the named niches.

export const PROSPECT_NICHES = [
  { key: 'reciclare', prefixes: ['36', '37', '38', '39', '4677', '4687'] },
  { key: 'inginerie', prefixes: ['7112', '7120'] },
  { key: 'instalatii', prefixes: ['4321', '4322', '4329'] },
  { key: 'service_industrial', prefixes: ['3312', '3314', '3320', '4669', '4664'] },
  { key: 'medical', prefixes: ['4646', '8622', '8623', '8690'] },
  { key: 'confectii_metalice', prefixes: ['2511', '2512', '2223', '2553'] },
  { key: 'facility_management', prefixes: ['81'] },
] as const

export const PROSPECT_NICHE_OTHER = 'altele' as const

export const PROSPECT_NICHE_KEYS = [...PROSPECT_NICHES.map((n) => n.key), PROSPECT_NICHE_OTHER] as const
export type ProspectNicheKey = (typeof PROSPECT_NICHE_KEYS)[number]

export const ALL_NICHE_PREFIXES: readonly string[] = PROSPECT_NICHES.flatMap((n) => [...n.prefixes])

export const NICHE_PREFIXES_BY_KEY: Record<string, readonly string[]> = Object.fromEntries(
  PROSPECT_NICHES.map((n) => [n.key, n.prefixes]),
)
