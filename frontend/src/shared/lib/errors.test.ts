import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import { errorCode, errorText, toastError } from './errors'

const toastMock = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('sonner', () => ({ toast: toastMock }))

beforeEach(() => toastMock.error.mockReset())

describe('errorText', () => {
  it('shows the text the server sent', () => {
    expect(errorText(new ApiError(404, 'Clientul nu există.', 'CLIENT_NOT_FOUND'))).toBe('Clientul nu există.')
  })

  it("prefers the page's own text for a code it overrides", () => {
    const err = new ApiError(400, 'Preview expired.', 'IMPORT_TOKEN_EXPIRED')
    expect(errorText(err)).toBe('Previzualizarea a expirat. Încarcă fișierul din nou.')
  })

  it('keeps the message of an error without a code', () => {
    expect(errorText(new ApiError(0, 'Nu ajung la server.'))).toBe('Nu ajung la server.')
  })

  it('never shows the text of a failed fetch or a bug', () => {
    expect(errorText(new TypeError('Failed to fetch'))).toBe('Nu ajung la server. Verifică conexiunea și încearcă din nou.')
    expect(errorText(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe('Ceva n-a mers. Încearcă din nou.')
  })

  it('handles something thrown that is not an error', () => {
    expect(errorText('boom')).toBe('Ceva n-a mers. Încearcă din nou.')
    expect(errorText(undefined)).toBe('Ceva n-a mers. Încearcă din nou.')
  })

  it("keeps the app's own error text", () => {
    expect(errorText(new Error('Alege un fișier.'))).toBe('Alege un fișier.')
  })
})

describe('errorCode', () => {
  it('reads the code of an API error only', () => {
    expect(errorCode(new ApiError(409, 'x', 'DRAFT_CHANGED'))).toBe('DRAFT_CHANGED')
    expect(errorCode(new Error('x'))).toBeNull()
  })
})

describe('toastError', () => {
  it('adds the code under the text for a server or integration error', () => {
    toastError(new ApiError(502, 'ANAF nu răspunde acum.', 'ANAF_UNAVAILABLE'))
    expect(toastMock.error).toHaveBeenCalledWith('ANAF nu răspunde acum.', { description: 'Cod: ANAF_UNAVAILABLE' })

    toastError(new ApiError(500, 'Eroare internă pe server.', 'INTERNAL'))
    expect(toastMock.error).toHaveBeenLastCalledWith('Eroare internă pe server.', { description: 'Cod: INTERNAL' })
  })

  it('leaves the code out of an everyday error', () => {
    toastError(new ApiError(404, 'Clientul nu există.', 'CLIENT_NOT_FOUND'))
    expect(toastMock.error).toHaveBeenCalledWith('Clientul nu există.', undefined)
  })

  it('uses the fallback for something that is not an error', () => {
    toastError('boom', 'Salvarea n-a mers.')
    expect(toastMock.error).toHaveBeenCalledWith('Salvarea n-a mers.', undefined)
  })
})
