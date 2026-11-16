import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { cookiePlugin, parseCookies, serializeCookie } from './cookie.js'

describe('cookiePlugin', () => {
  it('parses cookie headers including = in values and URL encoding', () => {
    const parsed = parseCookies('vana_session=abc.def%3D%3D; theme=dark; quoted="hello"')
    expect(parsed.vana_session).toBe('abc.def==')
    expect(parsed.theme).toBe('dark')
    expect(parsed.quoted).toBe('hello')
  })

  it('serializes HttpOnly, Secure, SameSite, Path, and Max-Age attributes', () => {
    const header = serializeCookie('vana_session', 'tok', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 3600,
    })
    expect(header).toBe('vana_session=tok; Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Lax')
  })

  it('reads request.cookies and sets/clears multiple cookies in Fastify', async () => {
    const app = Fastify()
    await app.register(cookiePlugin)

    app.get('/read', async (req) => ({ session: req.cookies.vana_session ?? null }))
    app.post('/login', async (_req, reply) => {
      reply
        .setCookie('vana_session', 'jwt123', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 600 })
        .setCookie('vana_refresh', 'ref456', { httpOnly: true, sameSite: 'strict', path: '/api/auth', maxAge: 1200 })
      return { ok: true }
    })
    app.post('/logout', async (_req, reply) => {
      reply.clearCookie('vana_session', { path: '/' }).clearCookie('vana_refresh', { path: '/api/auth' })
      return { ok: true }
    })

    const readRes = await app.inject({ method: 'GET', url: '/read', headers: { cookie: 'vana_session=hello' } })
    expect(readRes.json()).toEqual({ session: 'hello' })

    const loginRes = await app.inject({ method: 'POST', url: '/login' })
    const sessionCookie = loginRes.cookies.find((c) => c.name === 'vana_session')
    const refreshCookie = loginRes.cookies.find((c) => c.name === 'vana_refresh')
    expect(sessionCookie).toMatchObject({ value: 'jwt123', httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 600 })
    expect(refreshCookie).toMatchObject({ value: 'ref456', httpOnly: true, sameSite: 'Strict', path: '/api/auth', maxAge: 1200 })

    const logoutRes = await app.inject({ method: 'POST', url: '/logout' })
    const clearedSession = logoutRes.cookies.find((c) => c.name === 'vana_session')
    expect(clearedSession?.value).toBe('')
    expect(clearedSession?.maxAge).toBe(0)

    await app.close()
  })
})
