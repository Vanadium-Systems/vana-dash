/**
 * GET /api/email-images/:filename — servire publică (fără sesiune) a pozelor inserate în
 * editorul rich-text. Upload-ul (POST, multipart, authenticate) nu are test dedicat aici —
 * fără precedent de testare multipart în acest repo (nici archive/routes.ts, care are exact
 * același pattern, nu-l testează); validarea (mimetype/size) e simplă, inline.
 */
import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { saveDocument } from '../../shared/lib/storage.js'

const app = await buildServer()
await app.ready()
afterAll(async () => app.close())

describe('GET /api/email-images/:filename', () => {
  it('returns 404 for a filename that does not match the UUID.ext pattern', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/email-images/not-a-uuid.png' })
    expect(res.statusCode).toBe(404)
  })

  it('returns 404 for a path-traversal attempt', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/email-images/..%2F..%2Fpackage.json' })
    expect(res.statusCode).toBe(404)
  })

  it('returns 404 for a validly-shaped filename that was never uploaded', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/email-images/${randomUUID()}.png` })
    expect(res.statusCode).toBe(404)
  })

  it('serves an existing image with the correct Content-Type and a long cache header', async () => {
    const filename = `${randomUUID()}.png`
    const fakePngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]) // doar semnătura PNG, suficient pt. test
    await saveDocument(`email-images/${filename}`, fakePngBytes)

    const res = await app.inject({ method: 'GET', url: `/api/email-images/${filename}` })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toContain('immutable')
    expect(res.rawPayload).toEqual(fakePngBytes)
  })

  it('rejects an unsupported extension even if the rest of the pattern matches', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/email-images/${randomUUID()}.svg` })
    expect(res.statusCode).toBe(404)
  })
})
