/**
 * The error shape of PLAN E1: `{ success: false, error: { code, message } }`, the text in the
 * language of the request and nothing from an exception in the answer.
 */
import Fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { errorHandler, fail, httpError, notFoundHandler } from './http-error.js'
import type { Locale } from './locale.js'
import { runWithFreshActor } from './request-context.js'

class CompanyRuleError extends Error {
  readonly statusCode = 400
  readonly userFacing = true
}

class ThirdPartyClientError extends Error {
  readonly statusCode = 400
  readonly code = 'ERR_UPSTREAM_LEAK'
}

const app = Fastify()
app.setValidatorCompiler(validatorCompiler)
app.setSerializerCompiler(serializerCompiler)
app.setErrorHandler(errorHandler)
app.setNotFoundHandler(notFoundHandler)
app.addHook('onRequest', (request, _reply, done) => {
  const locale = request.headers['x-locale'] === 'en' ? 'en' : ('ro' as Locale)
  runWithFreshActor({ userId: null, ip: null, locale }, done)
})
app.get('/thrown', async () => {
  throw httpError(404, 'NOT_FOUND', {}, { clientId: 'c-1' })
})
app.get('/answered', async (_request, reply) => fail(reply, 409, 'CONFLICT'))
app.get('/own-text', async (_request, reply) => fail(reply, 400, 'IMPORT_EMPTY', { message: 'Fișierul e gol.' }))
app.get('/no-text', async () => {
  throw httpError(409, 'SOMETHING_WITHOUT_TEXT')
})
app.get('/crash', async () => {
  throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2')
})
app.get('/domain', async () => {
  throw new CompanyRuleError('Fusul orar nu e valid.')
})
app.get('/third-party', async () => {
  throw new ThirdPartyClientError('secret endpoint https://internal:8443 rejected key')
})
app.post('/json', async () => ({ success: true }))
app.post('/validated', { schema: { body: z.object({ amount: z.number().positive() }) } }, async () => ({ success: true }))
await app.ready()
afterAll(() => app.close())

const get = (url: string, locale: Locale = 'ro') => app.inject({ method: 'GET', url, headers: { 'x-locale': locale } })

describe('error shape', () => {
  it('translates a thrown HttpError and keeps its details', async () => {
    const ro = await get('/thrown')
    expect(ro.statusCode).toBe(404)
    expect(ro.json()).toEqual({ success: false, error: { code: 'NOT_FOUND', message: 'Nu am găsit ce cauți. Poate a fost șters.', clientId: 'c-1' } })
    expect((await get('/thrown', 'en')).json().error.message).toBe("We couldn't find what you asked for. It may have been deleted.")
  })

  it('answers through fail() with the same shape', async () => {
    const res = await get('/answered', 'en')
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toEqual({ code: 'CONFLICT', message: 'It changed in the meantime. Reload the page and try again.' })
  })

  it('keeps a text the route already wrote', async () => {
    expect((await get('/own-text')).json().error).toEqual({ code: 'IMPORT_EMPTY', message: 'Fișierul e gol.' })
  })

  it('falls back on the text of the status for a code without one', async () => {
    const res = await get('/no-text')
    expect(res.json().error).toEqual({ code: 'SOMETHING_WITHOUT_TEXT', message: 'S-a schimbat între timp. Reîncarcă pagina și încearcă din nou.' })
  })

  it('hides the exception of a 5xx', async () => {
    const res = await get('/crash', 'en')
    expect(res.statusCode).toBe(500)
    expect(res.json().error).toEqual({ code: 'INTERNAL', message: 'Internal server error. Try again in a minute.' })
    expect(res.body).not.toContain('ECONNREFUSED')
  })

  it('keeps the text of a domain error that is still not mapped to a code', async () => {
    expect((await get('/domain')).json().error).toEqual({ code: 'BAD_REQUEST', message: 'Fusul orar nu e valid.' })
  })

  it('masks a third-party error subclass that carries statusCode and code', async () => {
    const res = await get('/third-party', 'en')
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toEqual({
      code: 'BAD_REQUEST',
      message: 'The request is not valid. Check the data and try again.',
    })
    expect(res.body).not.toContain('internal:8443')
    expect(res.body).not.toContain('ERR_UPSTREAM_LEAK')
  })

  it("does not pass on Fastify's own 4xx text", async () => {
    const broken = await app.inject({
      method: 'POST',
      url: '/json',
      headers: { 'content-type': 'application/json', 'x-locale': 'en' },
      payload: '{"amount":',
    })
    expect(broken.statusCode).toBe(400)
    expect(broken.json().error).toEqual({ code: 'BAD_REQUEST', message: 'The request is not valid. Check the data and try again.' })

    const unknown = await get('/no-such-route')
    expect(unknown.statusCode).toBe(404)
    expect(unknown.json().error.code).toBe('NOT_FOUND')
    expect(unknown.body).not.toContain('no-such-route')
  })

  it('turns a validation failure into VALIDATION_FAILED with the field named', async () => {
    const res = await app.inject({ method: 'POST', url: '/validated', headers: { 'x-locale': 'ro' }, payload: { amount: -1 } })
    expect(res.statusCode).toBe(400)
    const { error } = res.json()
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.message).toContain('amount')
  })
})

describe('HttpError message', () => {
  it('is the text, for code that reads err.message', () => {
    expect(httpError(404, 'NOT_FOUND').message).toBe('Nu am găsit ce cauți. Poate a fost șters.')
  })

  it('keeps the reason in the message for the log, not in the answer', async () => {
    const err = httpError(502, 'ANAF_UNAVAILABLE').causedBy(new Error('socket hang up'))
    expect(err.message).toBe('ANAF_UNAVAILABLE: socket hang up')
    expect(err.code).toBe('ANAF_UNAVAILABLE')
  })
})
