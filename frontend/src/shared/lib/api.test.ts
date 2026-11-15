import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, onPasswordConfirmRequired } from './api'

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const fetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()
const calls = (path: string) => fetchMock.mock.calls.filter(([p]) => p === path).length

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('session refresh', () => {
  it('shares one refresh between parallel 401s and retries each request once', async () => {
    const answered = new Set<string>()
    fetchMock.mockImplementation(async (path) => {
      if (path === '/api/auth/refresh') return json(200, { success: true })
      if (!answered.has(path)) {
        answered.add(path)
        return json(401, { success: false, error: 'x' })
      }
      return json(200, { success: true, data: path })
    })
    const results = await Promise.all([api.get('/api/a'), api.get('/api/b'), api.get('/api/c')])
    expect(results).toEqual(['/api/a', '/api/b', '/api/c'])
    expect(calls('/api/auth/refresh')).toBe(1)
    expect(calls('/api/a')).toBe(2)
  })

  it('does not loop when the refresh fails', async () => {
    fetchMock.mockImplementation(async (path) => json(401, { success: false, error: path === '/api/auth/refresh' ? 'SESSION_EXPIRED' : 'x' }))
    await expect(api.get('/api/auth/me')).rejects.toBeInstanceOf(ApiError)
    expect(calls('/api/auth/refresh')).toBe(1)
    expect(calls('/api/auth/me')).toBe(1)
  })

  it('does not retry twice when the retry is 401 again', async () => {
    fetchMock.mockImplementation(async (path) => (path === '/api/auth/refresh' ? json(200, { success: true }) : json(401, { success: false, error: 'x' })))
    await expect(api.get('/api/auth/me')).rejects.toMatchObject({ status: 401 })
    expect(calls('/api/auth/me')).toBe(2)
    expect(calls('/api/auth/refresh')).toBe(1)
  })

  it('never refreshes for the login route', async () => {
    fetchMock.mockImplementation(async () => json(401, { success: false, error: 'Parolă greșită' }))
    await expect(api.post('/api/auth/login', {})).rejects.toMatchObject({ message: 'Parolă greșită' })
    expect(calls('/api/auth/refresh')).toBe(0)
  })
})

describe('password confirmation', () => {
  const required = () => json(403, { success: false, error: { code: 'PASSWORD_CONFIRM_REQUIRED' } })

  it('retries once after the password is confirmed', async () => {
    let first = true
    fetchMock.mockImplementation(async () => {
      if (first) {
        first = false
        return required()
      }
      return json(200, { success: true, data: 'ok' })
    })
    onPasswordConfirmRequired(async () => {})
    await expect(api.post('/api/me/api-tokens', {})).resolves.toBe('ok')
    expect(calls('/api/me/api-tokens')).toBe(2)
  })

  it('throws the original error on cancel', async () => {
    fetchMock.mockImplementation(async () => required())
    onPasswordConfirmRequired(() => Promise.reject(new Error('cancelled')))
    await expect(api.post('/api/me/api-tokens', {})).rejects.toMatchObject({ status: 403, code: 'PASSWORD_CONFIRM_REQUIRED' })
    expect(calls('/api/me/api-tokens')).toBe(1)
  })
})
