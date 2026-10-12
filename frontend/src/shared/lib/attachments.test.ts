// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileFromUrl } from './attachments'

describe('fileFromUrl — atașare din Arhivă (ComposeDialog)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('descarcă blob-ul de la URL-ul presigned și îl encodează base64 cu numele dat', async () => {
    const blob = new Blob(['continut'], { type: 'application/pdf' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) }))

    const result = await fileFromUrl('https://r2.example/presigned', 'factura.pdf')

    expect(result.filename).toBe('factura.pdf')
    expect(result.content.length).toBeGreaterThan(0)
    vi.unstubAllGlobals()
  })

  it('aruncă o eroare clară dacă descărcarea eșuează (URL expirat/invalid)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))

    await expect(fileFromUrl('https://r2.example/presigned', 'factura.pdf')).rejects.toThrow('Descărcare eșuată pentru factura.pdf')
    vi.unstubAllGlobals()
  })
})
