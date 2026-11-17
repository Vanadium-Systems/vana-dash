/**
 * Every code a route answers with has a text in `errors.codes`, unless the call brings its own
 * `message`. Without the text the person would read the generic one of the status.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from '../../locales/en/errors.json' with { type: 'json' }
import ro from '../../locales/ro/errors.json' with { type: 'json' }

const SRC = join(import.meta.dirname, '../..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : []
  })
}

/** The text of a call from its opening parenthesis to the matching closing one. */
function callText(source: string, start: number): string {
  let depth = 0
  for (let i = start; i < source.length; i++) {
    if (source[i] === '(') depth++
    else if (source[i] === ')' && --depth === 0) return source.slice(start, i + 1)
  }
  return source.slice(start)
}

const CALL = /\b(?:fail\(\s*\w+\s*,\s*\d{3}\s*,|httpError\(\s*\d{3}\s*,|new HttpError\(\s*\d{3}\s*,)\s*'([A-Z][A-Z0-9_]+)'/g

function codesWithoutOwnText(): Map<string, string> {
  const found = new Map<string, string>()
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(CALL)) {
      const call = callText(source, source.indexOf('(', match.index))
      if (/\bmessage\s*:/.test(call)) continue
      found.set(match[1]!, file.slice(SRC.length + 1))
    }
  }
  return found
}

describe('error codes', () => {
  it('have a text in ro and en', () => {
    const missing = [...codesWithoutOwnText()]
      .filter(([code]) => !(code in ro.codes) || !(code in en.codes))
      .map(([code, file]) => `${code} (${file})`)
    expect(missing).toEqual([])
  })
})
