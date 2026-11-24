import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { config } from '../../shared/config.js'
import { fail } from '../../shared/lib/http-error.js'
import * as signing from './signing-service.js'

const SESSION_COOKIE = 'vd_sign'
const MAX_QES_PDF = 20 * 1024 * 1024

const IdParams = z.object({ id: z.string().uuid() })
const TokenParams = z.object({ token: z.string().min(40).max(60) })
const PageParams = TokenParams.extend({ n: z.coerce.number().int().min(1).max(500) })
const CreateBody = z.object({
  signerName: z.string().trim().min(1).max(160),
  signerEmail: z.string().trim().email().max(200),
  signerRole: z.string().trim().min(1).max(40).regex(/^[\p{L}0-9 _-]+$/u).default('Colaborator'),
  unsigned: z.boolean().default(false),
})

const visitor = (req: FastifyRequest): signing.Visitor => ({ ip: req.ip, userAgent: String(req.headers['user-agent'] ?? '') })
const session = (req: FastifyRequest): string | undefined => req.cookies?.[SESSION_COOKIE]
// The page and its answers stay out of search engines and caches: they carry a person's contract.
const privateAnswer = (reply: FastifyReply) => reply.header('X-Robots-Tag', 'noindex, nofollow').header('Cache-Control', 'no-store')

export function registerSigningRoutes(app: FastifyInstance) {
  const server = app.withTypeProvider<ZodTypeProvider>()

  // ── From the contract page (facturi.semnare-contracte) ──────────────────────────────────────
  server.get('/api/contracts/registry/:id/sign-requests', { preHandler: [app.authenticate], schema: { params: IdParams } }, async (req) => {
    return { success: true, data: await signing.listSignRequests(req.me, req.params.id) }
  })

  server.post('/api/contracts/registry/:id/sign-requests', { preHandler: [app.authenticate], schema: { params: IdParams, body: CreateBody } }, async (req, reply) => {
    return reply.code(201).send({ success: true, data: await signing.createSignRequest(req.me, req.params.id, req.body) })
  })

  server.delete('/api/contracts/sign-requests/:id', { preHandler: [app.authenticate], schema: { params: IdParams } }, async (req) => {
    await signing.revokeSignRequest(req.me, req.params.id)
    return { success: true }
  })

  server.get('/api/contracts/signing', { preHandler: [app.authenticate] }, async () => ({ success: true, data: await signing.getSigningSettings() }))

  server.put(
    '/api/contracts/signing',
    { preHandler: [app.authenticate], schema: { body: z.object({ downloadDays: z.number().int().min(1).max(365) }) } },
    async (req) => ({ success: true, data: await signing.updateSigningSettings(req.body) }),
  )

  server.post('/api/contracts/signing/certificate', { preHandler: [app.authenticate] }, async () => ({ success: true, data: await signing.createSigningCertificate() }))

  // ── The public page /semnare/:token: no account, the link and the emailed code ─────────────
  server.get(
    '/api/public/sign/:token',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } }, schema: { params: TokenParams } },
    async (req, reply) => {
      privateAnswer(reply)
      return { success: true, data: await signing.getPublicRequest(req.params.token, visitor(req)) }
    },
  )

  server.post(
    '/api/public/sign/:token/otp',
    {
      // Per link, not per IP: three codes in ten minutes is enough for a person and too slow for a mailbomb.
      config: { rateLimit: { max: 3, timeWindow: '10 minutes', keyGenerator: (req: FastifyRequest) => `sign-otp:${(req.params as { token: string }).token}` } },
      schema: { params: TokenParams },
    },
    async (req, reply) => {
      privateAnswer(reply)
      return { success: true, data: await signing.sendOtp(req.params.token, visitor(req)) }
    },
  )

  server.post(
    '/api/public/sign/:token/verify',
    {
      bodyLimit: 1024,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { params: TokenParams, body: z.object({ code: z.string().regex(/^\d{6}$/) }) },
    },
    async (req, reply) => {
      privateAnswer(reply)
      const { session: value, sessionMinutes, ...data } = await signing.verifyOtp(req.params.token, req.body.code, visitor(req))
      reply.setCookie(SESSION_COOKIE, value, {
        httpOnly: true,
        secure: config.isProduction,
        sameSite: 'strict',
        path: `/api/public/sign/${req.params.token}`,
        maxAge: sessionMinutes * 60,
      })
      return { success: true, data }
    },
  )

  server.get(
    '/api/public/sign/:token/pages/:n',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } }, schema: { params: PageParams } },
    async (req, reply) => {
      const png = await signing.renderPage(req.params.token, session(req), req.params.n)
      return privateAnswer(reply).type('image/png').send(png)
    },
  )

  server.post(
    '/api/public/sign/:token/sign',
    {
      bodyLimit: 512 * 1024,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { params: TokenParams, body: z.object({ signaturePng: z.string().max(450_000), consent: z.literal(true) }) },
    },
    async (req, reply) => {
      privateAnswer(reply)
      return { success: true, data: await signing.signRequest(req.params.token, session(req), req.body, visitor(req)) }
    },
  )

  server.post(
    '/api/public/sign/:token/decline',
    {
      bodyLimit: 4 * 1024,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: { params: TokenParams, body: z.object({ reason: z.string().trim().min(1).max(1000) }) },
    },
    async (req, reply) => {
      privateAnswer(reply)
      return { success: true, data: await signing.declineRequest(req.params.token, session(req), req.body.reason, visitor(req)) }
    },
  )

  server.post(
    '/api/public/sign/:token/upload-qes',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { params: TokenParams } },
    async (req, reply) => {
      privateAnswer(reply)
      const file = await req.file()
      if (!file) return fail(reply, 400, 'FILE_MISSING')
      if (file.mimetype !== 'application/pdf') return fail(reply, 415, 'UNSUPPORTED_MEDIA_TYPE')
      const pdf = await file.toBuffer()
      if (file.file.truncated || pdf.length > MAX_QES_PDF) return fail(reply, 413, 'PAYLOAD_TOO_LARGE')
      return { success: true, data: await signing.uploadQualified(req.params.token, session(req), pdf, visitor(req)) }
    },
  )

  server.get(
    '/api/public/sign/:token/download',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { params: TokenParams } },
    async (req, reply) => {
      const { pdf, fileName } = await signing.downloadForSigner(req.params.token, session(req), visitor(req))
      privateAnswer(reply).header('Content-Disposition', `attachment; filename="${fileName}"`)
      return reply.type('application/pdf').send(pdf)
    },
  )
}
