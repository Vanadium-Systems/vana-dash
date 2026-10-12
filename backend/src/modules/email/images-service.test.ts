import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { saveDocument } from '../../shared/lib/storage.js'
import { emailImageStoragePath, inlineStoredImages } from './images-service.js'

describe('inlineStoredImages (2026-08-11 — poze din editor → atașament MIME cid: la trimitere)', () => {
  it('returns the html unchanged with no attachments when there are no stored images', async () => {
    const html = '<p>Salut, fără poze aici</p>'
    const result = await inlineStoredImages(html)
    expect(result.html).toBe(html)
    expect(result.attachments).toHaveLength(0)
  })

  it('rewrites a stored image src to cid: and returns it as an attachment with a matching contentId', async () => {
    const filename = `${randomUUID()}.png`
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    await saveDocument(emailImageStoragePath(filename), bytes)

    const result = await inlineStoredImages(`<p>Uite:</p><img src="/api/email-images/${filename}">`)

    expect(result.html).toContain(`src="cid:${filename}"`)
    expect(result.html).not.toContain('/api/email-images/')
    expect(result.attachments).toHaveLength(1)
    expect(result.attachments[0]).toMatchObject({ filename, contentId: filename })
    expect(result.attachments[0]!.content).toEqual(bytes)
  })

  it('handles the same image referenced twice, producing one attachment (dedup)', async () => {
    const filename = `${randomUUID()}.png`
    await saveDocument(emailImageStoragePath(filename), Buffer.from([1, 2, 3]))

    const result = await inlineStoredImages(`<img src="/api/email-images/${filename}"><img src="/api/email-images/${filename}">`)

    expect(result.attachments).toHaveLength(1)
    expect((result.html.match(/cid:/g) ?? []).length).toBe(2)
  })

  it('handles two different images, both inlined', async () => {
    const a = `${randomUUID()}.png`
    const b = `${randomUUID()}.jpg`
    await saveDocument(emailImageStoragePath(a), Buffer.from([1]))
    await saveDocument(emailImageStoragePath(b), Buffer.from([2]))

    const result = await inlineStoredImages(`<img src="/api/email-images/${a}"><img src="/api/email-images/${b}">`)

    expect(result.attachments.map((att) => att.filename).sort()).toEqual([a, b].sort())
    expect(result.html).toContain(`cid:${a}`)
    expect(result.html).toContain(`cid:${b}`)
  })

  it('leaves an unrelated external image src untouched (e.g. a signature logo)', async () => {
    const html = '<img src="https://dash.vanadium.systems/logo.png">'
    const result = await inlineStoredImages(html)
    expect(result.html).toBe(html)
    expect(result.attachments).toHaveLength(0)
  })

  it('isolates a missing file (deleted from disk) — leaves that src untouched, no attachment, does not throw', async () => {
    const missingFilename = `${randomUUID()}.png`
    await expect(inlineStoredImages(`<img src="/api/email-images/${missingFilename}">`)).resolves.toEqual({
      html: `<img src="/api/email-images/${missingFilename}">`,
      attachments: [],
    })
  })
})
