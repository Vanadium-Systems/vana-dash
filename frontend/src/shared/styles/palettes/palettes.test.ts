import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const NON_COLOR_TOKENS = new Set([
  '--control-sm',
  '--control-md',
  '--control-lg',
  '--row-h',
  '--page-x',
  '--page-y',
  '--ease-out',
  '--ease-in-out',
  '--ease-drawer',
  '--ease-mercury',
  '--duration-fast',
  '--duration-standard',
  '--duration-screen',
  '--enter-scale',
  '--enter-shift',
  '--glass-alpha',
  '--glass-blur',
  '--horizon',
  '--resin-i',
  '--resin-k',
  '--radius',
])

function extractTokens(css: string, selectorRegex: RegExp): string[] {
  const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const tokens = new Set<string>()
  for (const match of cleaned.matchAll(selectorRegex)) {
    const block = match[1] ?? ''
    for (const prop of block.matchAll(/(--[\w-]+)\s*:/g)) {
      const name = prop[1]
      if (name && !NON_COLOR_TOKENS.has(name)) tokens.add(name)
    }
  }
  return [...tokens].sort()
}

describe('theme palettes', () => {
  const indexCss = readFileSync(resolve(__dirname, '../../../index.css'), 'utf8')
  const vanadiumLight = extractTokens(indexCss, /:root\s*\{([\s\S]*?)\n\s*\}/g)
  const vanadiumDark = extractTokens(indexCss, /\.dark\s*\{([\s\S]*?)\n\s*\}/g)

  it.each(['grafit', 'padure', 'chihlimbar', 'ardezie'])('%s defines every vanadium light and dark token', (id) => {
    const css = readFileSync(resolve(__dirname, `${id}.css`), 'utf8')
    const light = extractTokens(css, new RegExp(`:root\\[data-palette='${id}'\\]\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, 'g'))
    const dark = extractTokens(css, new RegExp(`:root\\[data-palette='${id}'\\]\\.dark\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, 'g'))

    expect(light).toEqual(vanadiumLight)
    expect(dark).toEqual(vanadiumDark)
  })
})
