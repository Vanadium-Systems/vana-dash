import { describe, expect, it } from 'vitest'
import en from '../../locales/en/index.js'
import ro from '../../locales/ro/index.js'

// Both languages must have the same keys and name the same variables. A plural is compared
// as one key, since each language has its own set of forms.

const PLURAL_FORMS = new Set(['zero', 'one', 'two', 'few', 'many', 'other'])
type Tree = { [key: string]: string | Tree }

function isPlural(node: Tree): boolean {
  const keys = Object.keys(node)
  return keys.length > 0 && keys.every((key) => PLURAL_FORMS.has(key))
}

function variables(text: string): string[] {
  return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] as string).sort()
}

function flatten(node: Tree, prefix = '', out = new Map<string, string[]>()): Map<string, string[]> {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') out.set(path, variables(value))
    else if (isPlural(value)) out.set(path, variables(String(value.other)))
    else flatten(value, path, out)
  }
  return out
}

describe('server locales', () => {
  const roKeys = flatten(ro as Tree)
  const enKeys = flatten(en as Tree)

  it('ro and en have the same keys', () => {
    expect([...enKeys.keys()].sort()).toEqual([...roKeys.keys()].sort())
  })

  it('each key uses the same variables in both languages', () => {
    const different = [...roKeys].filter(([key, vars]) => enKeys.has(key) && enKeys.get(key)!.join() !== vars.join())
    expect(different.map(([key]) => key)).toEqual([])
  })

  it('every plural has the `other` form', () => {
    const missing: string[] = []
    const walk = (node: Tree, prefix: string) => {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === 'string') continue
        if (isPlural(value) && typeof value.other !== 'string') missing.push(`${prefix}${key}`)
        else if (!isPlural(value)) walk(value, `${prefix}${key}.`)
      }
    }
    walk(ro as Tree, 'ro:')
    walk(en as Tree, 'en:')
    expect(missing).toEqual([])
  })
})
