// Per-person display preferences: interface language and the currency totals are shown in.
// The frontend keeps the same lists in frontend/src/shared/lib/locale.ts.

export const LOCALES = ['ro', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const INTL_TAG: Record<Locale, string> = { ro: 'ro-RO', en: 'en-GB' }

/** Languages a person can pick. A new locale stays out of this list until every screen has it. */
export const ENABLED_LOCALES: readonly Locale[] = ['ro', 'en']

// The currencies the BNR feed stores a rate for, plus RON itself.
export const DISPLAY_CURRENCIES = ['RON', 'EUR', 'USD'] as const
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number]

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

export function isDisplayCurrency(value: unknown): value is DisplayCurrency {
  return typeof value === 'string' && (DISPLAY_CURRENCIES as readonly string[]).includes(value)
}
