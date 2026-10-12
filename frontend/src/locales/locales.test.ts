import { describe, expect, it } from 'vitest'
import en from './en'
import ro from './ro'

// Both languages must have the same keys and name the same variables. Plural forms differ per
// language (`_one`, `_few`, `_other` in Romanian; `_one`, `_other` in English), so a plural
// is compared as one key.

const PLURAL = /_(zero|one|two|few|many|other)$/
type Tree = { [key: string]: string | Tree }

function variables(text: string): string[] {
  return [...new Set([...text.matchAll(/\{\{\s*(\w+)/g)].map((match) => match[1] as string))].sort()
}

function flatten(node: Tree, prefix: string, out = new Map<string, string[]>()): Map<string, string[]> {
  for (const [key, value] of Object.entries(node)) {
    if (typeof value !== 'string') {
      flatten(value, `${prefix}${key}.`, out)
      continue
    }
    const path = `${prefix}${key.replace(PLURAL, '')}`
    out.set(path, [...new Set([...(out.get(path) ?? []), ...variables(value)])].sort())
  }
  return out
}

function allKeys(resources: Record<string, object>): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const [namespace, tree] of Object.entries(resources)) flatten(tree as Tree, `${namespace}:`, out)
  return out
}

describe('interface locales', () => {
  const roKeys = allKeys(ro)
  const enKeys = allKeys(en)

  it('ro and en have the same keys', () => {
    const missingInEn = [...roKeys.keys()].filter((key) => !enKeys.has(key))
    const missingInRo = [...enKeys.keys()].filter((key) => !roKeys.has(key))
    expect({ missingInEn, missingInRo }).toEqual({ missingInEn: [], missingInRo: [] })
  })

  it('each key uses the same variables in both languages', () => {
    const different = [...roKeys].filter(([key, vars]) => enKeys.has(key) && enKeys.get(key)!.join() !== vars.join())
    expect(different.map(([key]) => key)).toEqual([])
  })

  it('every plural has the `_other` form in both languages', () => {
    const missing: string[] = []
    const walk = (node: Tree, prefix: string) => {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value !== 'string') walk(value, `${prefix}${key}.`)
        else if (PLURAL.test(key) && typeof node[key.replace(PLURAL, '_other')] !== 'string') missing.push(`${prefix}${key}`)
      }
    }
    for (const [locale, resources] of [['ro', ro], ['en', en]] as const) {
      for (const [namespace, tree] of Object.entries(resources)) walk(tree as Tree, `${locale}/${namespace}:`)
    }
    expect(missing).toEqual([])
  })

  it('no text is left empty', () => {
    const empty: string[] = []
    const walk = (node: Tree, prefix: string) => {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value !== 'string') walk(value, `${prefix}${key}.`)
        else if (!value.trim()) empty.push(`${prefix}${key}`)
      }
    }
    for (const [locale, resources] of [['ro', ro], ['en', en]] as const) {
      for (const [namespace, tree] of Object.entries(resources)) walk(tree as Tree, `${locale}/${namespace}:`)
    }
    expect(empty).toEqual([])
  })
})
