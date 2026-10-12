import en from '../../locales/en/index.js'
import ro from '../../locales/ro/index.js'
import type { Locale } from './locale.js'
import { currentLocale } from './request-context.js'

// Server-side texts: error messages, feature labels, system emails, push notifications.
// `ro` is the reference; `en` must have the same keys (checked by locales.test.ts).
//
// A plural is an object with the CLDR forms the language uses (`one`, `few`, `other`), picked
// by `params.count`.

type Tree = { readonly [key: string]: string | Tree }

type PluralForm = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'
type IsPlural<T> = keyof T extends PluralForm ? true : false

type Leaves<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : IsPlural<T[K]> extends true
      ? `${Prefix}${K}`
      : Leaves<T[K], `${Prefix}${K}.`>
}[keyof T & string]

export type TrKey = Leaves<typeof ro>
export type TrParams = Record<string, string | number>

const RESOURCES: Record<Locale, Tree> = { ro, en }
const PLURAL_RULES: Record<Locale, Intl.PluralRules> = {
  ro: new Intl.PluralRules('ro-RO'),
  en: new Intl.PluralRules('en-GB'),
}

function lookup(locale: Locale, key: string): string | Tree | undefined {
  let node: string | Tree | undefined = RESOURCES[locale]
  for (const part of key.split('.')) {
    if (typeof node !== 'object') return undefined
    node = node[part]
  }
  return node
}

/** A text in an explicit language: jobs, emails and push go by the recipient, not the sender. */
export function trFor(locale: Locale, key: TrKey, params?: TrParams): string {
  let entry = lookup(locale, key)
  if (typeof entry === 'object') {
    const count = Number(params?.count ?? 0)
    entry = entry[PLURAL_RULES[locale].select(count)] ?? entry.other
  }
  if (typeof entry !== 'string') return key
  if (!params) return entry
  return entry.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) =>
    name in params ? String(params[name]) : placeholder,
  )
}

/** A text in the language of the current request. */
export function tr(key: TrKey, params?: TrParams): string {
  return trFor(currentLocale(), key, params)
}
