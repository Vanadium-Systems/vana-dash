// Per-person display preferences: interface language and the currency totals are shown in.
// The backend keeps the same lists in backend/src/shared/lib/locale.ts.

export const LOCALES = ['ro', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const INTL_TAG: Record<Locale, string> = { ro: 'ro-RO', en: 'en-GB' }

/** Each language under its own name, so the switch reads the same from either side. */
export const LOCALE_NAMES: Record<Locale, string> = { ro: 'Română', en: 'English' }

export const DISPLAY_CURRENCIES = ['RON', 'EUR', 'USD'] as const
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number]

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}
