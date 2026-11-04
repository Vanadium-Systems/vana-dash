import { validateHeaderValue } from 'node:http'
import { describe, expect, it } from 'vitest'
import { contentDisposition } from './text.js'

describe('contentDisposition', () => {
  it('accepts a macOS screenshot name that Node would reject as a raw header', () => {
    const name = `Captur${String.fromCodePoint(0x103)} de ecran din 2026-11-04 la 08.55.52 AM "x".png`
    const value = contentDisposition('inline', name)
    expect(() => validateHeaderValue('Content-Disposition', value)).not.toThrow()
    expect(value).toContain(`filename*=UTF-8''${encodeURIComponent(name)}`)
    expect(value).toContain(`filename="Captura de ecran din 2026-11-04 la 08.55.52_AM 'x'.png"`)
  })
})
