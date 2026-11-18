import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import { errorCode, errorDetail, errorText, failureCodeLine, failureLine, failureText, toastError } from './errors'

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

describe('failureText', () => {
  it('shows the page text of a stored failure code and the code line', () => {
    expect(failureText('EMAIL_SEND_TIMEOUT')).toBe('Serverul de email nu a răspuns la timp. Încearcă din nou.')
    expect(failureCodeLine('EMAIL_SEND_TIMEOUT')).toBe('Cod: EMAIL_SEND_TIMEOUT')
    expect(failureLine('SYNC_TIMEOUT')).toBe('Platforma nu a răspuns la timp. Cod: SYNC_TIMEOUT')
  })

  it('has a text for every code the server can store', () => {
    for (const code of [
      'EMAIL_SEND_RATE_LIMITED',
      'EMAIL_SEND_AUTH_FAILED',
      'EMAIL_RECIPIENT_REJECTED',
      'EMAIL_SEND_TIMEOUT',
      'EMAIL_SEND_FAILED',
      'SYNC_TIMEOUT',
      'SYNC_AUTH_FAILED',
      'SYNC_UNREACHABLE',
      'SYNC_FAILED',
    ]) {
      expect(failureText(code), code).not.toBe('Ceva n-a mers. Încearcă din nou.')
    }
  })

  it('falls back on the generic text for a code without one', () => {
    expect(failureText('SOMETHING_NEW')).toBe('Ceva n-a mers. Încearcă din nou.')
  })
})

describe('errorDetail', () => {
  it('reads a detail on the error object, and at the top for older routes', () => {
    const now = new ApiError(409, 'x', 'PROSPECT_EXISTS', { success: false, error: { code: 'PROSPECT_EXISTS', message: 'x', existing: { id: 'p1' } } })
    expect(errorDetail(now, 'existing')).toEqual({ id: 'p1' })
    const before = new ApiError(409, 'x', 'CONFLICT', { success: false, error: 'x', data: { id: 'n1' } })
    expect(errorDetail(before, 'data')).toEqual({ id: 'n1' })
    expect(errorDetail(new Error('x'), 'existing')).toBeUndefined()
  })
})
