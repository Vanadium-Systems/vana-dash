import i18next from 'i18next'
import type roResources from '@/locales/ro'
import { isLocale, type Locale } from './locale'

// Interface texts. One namespace per module plus `common`; keys are `module:path.to.text`.
//
// `t()` is a plain function, usable outside components too (table columns, label maps,
// helpers). Texts are read once per render and the language changes rarely, so
// `changeLocale()` saves the choice and reloads the page instead of re-rendering the tree.
// `initI18n()` has to finish before the app modules are imported (see main.tsx), so that
// constants built at module level already see the right language.

export type Resources = typeof roResources

type PluralSuffix = '_zero' | '_one' | '_two' | '_few' | '_many' | '_other'
type WithoutPlural<K extends string> = K extends `${infer Base}${PluralSuffix}` ? Base : K
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? WithoutPlural<K> : `${K}.${Paths<T[K]>}`
}[keyof T & string]

/** Every text key, checked against the Romanian resources: a typo fails `pnpm typecheck`. */
export type TKey = { [N in keyof Resources & string]: `${N}:${Paths<Resources[N]>}` }[keyof Resources & string]
export type TParams = Record<string, string | number | null | undefined>

const STORAGE_KEY = 'vd.locale'
const FALLBACK_LOCALE: Locale = 'ro'

const LOADERS: Record<Locale, () => Promise<{ default: Record<string, object> }>> = {
  ro: () => import('@/locales/ro'),
  en: () => import('@/locales/en'),
}

let activeLocale: Locale = FALLBACK_LOCALE

export function getLocale(): Locale {
  return activeLocale
}

export function t(key: TKey, params?: TParams): string {
  return (i18next.t as (key: string, options?: TParams) => string)(key, params)
}

/** Synchronous init with resources already in hand. Used by `initI18n` and by the test setup. */
export function initWithResources(locale: Locale, resources: Record<string, object>): void {
  activeLocale = locale
  void i18next.init({
    lng: locale,
    fallbackLng: false,
    resources: { [locale]: resources },
    ns: Object.keys(resources),
    defaultNS: 'common',
    // React escapes what it renders.
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false,
  })
  if (typeof document !== 'undefined') document.documentElement.lang = locale
}

function storedLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isLocale(stored) ? stored : null
  } catch {
    return null
  }
}

/** Before login nobody has a profile yet: the installation says which language it starts in. */
async function serverDefaultLocale(): Promise<Locale> {
  try {
    const res = await fetch('/api/auth/locale', { signal: AbortSignal.timeout(3000) })
    const body = (await res.json()) as { data?: { defaultLocale?: unknown } }
    return isLocale(body.data?.defaultLocale) ? body.data.defaultLocale : FALLBACK_LOCALE
  } catch {
    return FALLBACK_LOCALE
  }
}

/**
 * The language comes from what this person chose last (kept in localStorage and synced from the
 * profile after login), otherwise from the installation default. Never from the browser: twice
 * in another product, a Romanian company got an English interface because of a browser setting.
 */
export async function initI18n(): Promise<void> {
  const locale = storedLocale() ?? (await serverDefaultLocale())
  const resources = await LOADERS[locale]()
  initWithResources(locale, resources.default)
}

function rememberAndReload(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale)
  } catch {
    // Without storage the reload would come back in the old language and reload again.
    return
  }
  window.location.reload()
}

/** The person's own choice, from My profile or from a page before login. */
export async function changeLocale(locale: Locale, save?: () => Promise<unknown>): Promise<void> {
  if (locale === activeLocale) return
  if (save) await save()
  // The service worker keeps a copy of /api/auth/me; a stale one would switch the language back.
  if ('caches' in window) await caches.delete('auth-cache').catch(() => {})
  rememberAndReload(locale)
}

/** After login: the profile wins over what this browser remembered (changed on another device). */
export function syncLocaleWithProfile(profileLocale: Locale, enabledLocales: readonly Locale[]): void {
  if (profileLocale === activeLocale || !enabledLocales.includes(profileLocale)) return
  rememberAndReload(profileLocale)
}
