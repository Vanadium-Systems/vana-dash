import { eq } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest, onRequestHookHandler } from 'fastify'
import fp from 'fastify-plugin'
import { db } from '../db/client.js'
import { apiTokens, platformAccessLog, users } from '../db/schema/index.js'
import { tr } from '../lib/i18n.js'
import { findActiveTenant } from '../lib/tenant-loop.js'
import { withRlsBypass } from '../lib/tenancy.js'
import { safeEqual } from '../lib/crypto.js'
import { ENABLED_LOCALES, isLocale } from '../lib/locale.js'
import { actorStore, runWithFreshActor } from '../lib/request-context.js'
import type { SessionUser } from '../lib/session.js'
import { loadSessionUser } from '../lib/session.js'
import { isSessionUsable } from '../lib/sessions.js'
import { featureForRequest } from './feature-guard.js'
import {
  API_TOKEN_LAST_USED_INTERVAL_MS,
  API_TOKEN_RATE_LIMIT_PER_MIN,
  bearerFromHeader,
  findUsableApiToken,
  isPathDeniedToTokens,
  tokenFeatures,
  type ApiTokenRow,
} from '../lib/api-tokens.js'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    /** Omul din sesiune, calculat o dată pe request de `authenticate`. */
    me: SessionUser
    /** The personal API token the request came with; null for the session cookie. */
    apiToken: { id: string; name: string } | null
    /** The login session behind the cookie; null for a token or a pre-long-session cookie. */
    session: { id: string; familyId: string; passwordConfirmedAt: Date | null } | null
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    // `sv` = session_version la emiterea tokenului; o sesiune veche (parolă resetată, user
    // dezactivat) primește 401 chiar dacă tokenul nu a expirat.
    // `sid` = the user_sessions row behind this access token; absent on tokens issued before
    // long sessions (they expire on their own within 7 days).
    payload: { sub: string; sv: number; tid?: string; sid?: string }
    user: { sub: string; sv: number; tid?: string; sid?: string }
  }
}

const LAST_SEEN_MIN_INTERVAL_MS = 60_000

export const authPlugin = fp(async (app) => {
  app.decorateRequest('apiToken', null)
  app.decorateRequest('session', null)
  // Per-token budget, counted only once the token is known to be real. Requests made by `/mcp`
  // tools come back through here with the same token, so they count too.
  const tokenRateLimit = app.createRateLimit({
    max: API_TOKEN_RATE_LIMIT_PER_MIN,
    timeWindow: '1 minute',
    keyGenerator: (req) => `token:${req.apiToken?.id ?? ''}`,
  })
  // Store-ul de actor se deschide aici, înainte de orice rută; `authenticate` îl completează.
  app.addHook('onRequest', (request, _reply, done) => {
    // The pages before login send the language the visitor picked; a session overrides it below.
    const asked = request.headers['x-locale']
    const locale = isLocale(asked) && ENABLED_LOCALES.includes(asked) ? asked : undefined
    runWithFreshActor({ userId: null, ip: request.ip, locale }, done)
  })

  const authenticate = async (req: FastifyRequest, reply: FastifyReply) => {
    // Two sources of identity, one path after it: a personal API token (Bearer `vd_…`) or the
    // session cookie. The Bearer wins when both are sent, and a Bearer that is not ours is refused
    // instead of falling back to the cookie.
    const bearer = bearerFromHeader(req.headers.authorization)
    let me: SessionUser | null
    let apiToken: ApiTokenRow | null = null
    if (bearer !== null) {
      // The company is not known before the token row is read, as for the session user below.
      apiToken = bearer ? await withRlsBypass(() => findUsableApiToken(bearer)) : null
      if (!apiToken) return await reply.code(401).send({ success: false, error: 'TOKEN_INVALID' })
      const tokenUserId = apiToken.userId
      me = await withRlsBypass(() => loadSessionUser(tokenUserId))
      // No session_version check: changing the password does not revoke tokens, revoking does.
      if (!me || me.status !== 'active') return await reply.code(401).send({ success: false, error: 'TOKEN_INVALID' })
      const routeUrl = req.routeOptions.url ?? req.url.split('?')[0] ?? req.url
      if (isPathDeniedToTokens(req.method, routeUrl)) {
        return await reply.code(403).send({ success: false, error: 'TOKEN_NOT_ALLOWED' })
      }
      // Looking at another company is for the platform admin in the browser, never through a token.
      if (req.headers['x-tenant-id'] !== undefined) {
        return await reply.code(403).send({ success: false, error: 'TOKEN_NOT_ALLOWED' })
      }
      req.apiToken = { id: apiToken.id, name: apiToken.name }
      const budget = await tokenRateLimit(req)
      if (!budget.isAllowed && budget.isExceeded) {
        reply.header('retry-after', budget.ttlInSeconds)
        return await reply.code(429).send({ success: false, error: tr('errors.rateLimited') })
      }
      // A token never carries more than its features: no platform-admin powers and no checks that
      // look at the role kind instead of the features (archive / calendar sharing and the like).
      me = {
        ...me,
        features: tokenFeatures(me, apiToken.features),
        isPlatformAdmin: false,
        role: me.role ? { ...me.role, kind: 'custom' } : me.role,
      }
    } else {
      let payload: { sub: string; sv: number; tid?: string; sid?: string }
      try {
        payload = await req.jwtVerify()
      } catch {
        return await reply.code(401).send({ success: false, error: 'Unauthorized' })
      }

      // The company is not known before this row is read, so the lookup crosses companies.
      me = await withRlsBypass(() => loadSessionUser(payload.sub))
      if (!me) return await reply.code(401).send({ success: false, error: 'Unauthorized' })
      // Dezactivat sau cu sesiunea invalidată (parolă schimbată/resetată): delogat imediat,
      // fără să aștepte expirarea tokenului. 'invited' nu ajunge aici — n-are încă parolă.
      if (me.status !== 'active' || me.sessionVersion !== payload.sv) {
        return await reply.code(401).send({ success: false, error: 'Unauthorized' })
      }
      if (payload.tid && me.tenant && payload.tid !== me.tenant.id) {
        return await reply.code(401).send({ success: false, error: 'Unauthorized' })
      }
      // Logged out from "Dispozitive", or the family was revoked: the access token dies with it,
      // not 15 minutes later.
      if (payload.sid) {
        const sessionId = payload.sid
        const session = await withRlsBypass(() => isSessionUsable(sessionId))
        if (!session || session.userId !== me.id) {
          return await reply.code(401).send({ success: false, error: 'Unauthorized' })
        }
        req.session = { id: session.id, familyId: session.familyId, passwordConfirmedAt: session.passwordConfirmedAt }
      }
    }
    if (me.tenant && me.tenant.status !== 'active' && !me.tenant.isPlatformOwner) {
      return await reply.code(403).send({ success: false, error: tr('errors.tenants.suspended') })
    }
    // The platform admin can look at another company. Every request made that way is logged.
    let tenantId = me.tenant?.id
    const asked = req.headers['x-tenant-id']
    if (typeof asked === 'string' && asked !== tenantId) {
      if (!me.isPlatformAdmin) return await reply.code(403).send({ success: false, error: tr('errors.tenants.headerForbidden') })
      const target = /^[0-9a-f-]{36}$/i.test(asked) ? await findActiveTenant(asked) : null
      if (!target) return await reply.code(404).send({ success: false, error: tr('errors.tenants.notFound') })
      tenantId = target.id
      await db.insert(platformAccessLog).values({ userId: me.id, tenantId, method: req.method, path: req.url.split('?')[0] ?? req.url, ip: req.ip })
    }

    // Guard de funcționalitate: rută nouă → decizie nouă, nu implicit „merge" (catalogul
    // acoperă toate rutele sau serverul nu pornește, vezi feature-guard.ts).
    const required = featureForRequest(req, app.featureGuard)
    if (required && !me.features.includes(required)) {
      return await reply
        .code(403)
        .send({ success: false, error: { code: 'FEATURE_FORBIDDEN', feature: required } })
    }

    req.me = me
    // Contextul requestului (audit, created_by) primește acum omul — servicile îl citesc
    // fără să-l primească la fiecare apel.
    const store = actorStore()
    if (store) {
      store.userId = me.id
      store.locale = me.locale
      store.displayCurrency = me.displayCurrency
      store.tenantId = tenantId
      store.apiTokenId = apiToken?.id
    }

    // „Ultima activitate" din pagina Echipă. Cel mult o scriere pe minut și om, ca un poll
    // la 15s să nu devină un UPDATE pe fiecare cerere.
    if (!me.lastSeenAt || Date.now() - me.lastSeenAt.getTime() > LAST_SEEN_MIN_INTERVAL_MS) {
      const userId = me.id
      await withRlsBypass(() => db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId)))
    }
    if (apiToken && (!apiToken.lastUsedAt || Date.now() - apiToken.lastUsedAt.getTime() > API_TOKEN_LAST_USED_INTERVAL_MS)) {
      const tokenId = apiToken.id
      await withRlsBypass(() =>
        db.update(apiTokens).set({ lastUsedAt: new Date(), lastUsedIp: req.ip }).where(eq(apiTokens.id, tokenId)),
      )
    }
  }
  app.decorate('authenticate', authenticate)

  // Fastify validează body/query/params ÎNAINTE de preHandler, deci cu `preHandler: [app.authenticate]`
  // un request anonim cu body greșit primea 400 cu lista câmpurilor schemei în loc de 401. Mutăm
  // autentificarea în preValidation pe toate rutele care o declară, fără să atingem fiecare rută.
  app.addHook('onRoute', (route) => {
    const preHandlers = [route.preHandler ?? []].flat()
    if (!preHandlers.includes(authenticate)) return
    route.preHandler = preHandlers.filter((hook) => hook !== authenticate)
    route.preValidation = [authenticate, ...[route.preValidation ?? []].flat()]
  })
})

/**
 * `onRequest` hook for machine-to-machine routes that carry a secret in a header
 * (X-Ingest-Token and the like). It runs before the body is read, so a caller without the
 * token gets 401 without the server buffering up to `bodyLimit` for it, and never sees the
 * shape of the payload in a validation error. Fail-closed: with no secret in env, every request
 * is refused. A missing secret and a wrong token answer the same; only the server log differs.
 */
export function requireIngestToken(header: string, getExpected: () => string, envName: string): onRequestHookHandler {
  return async (req, reply) => {
    const expected = getExpected()
    const providedRaw = req.headers[header.toLowerCase()]
    const provided = Array.isArray(providedRaw) ? providedRaw[0] : providedRaw
    if (!expected) req.log.error(`${envName} neconfigurat — resping toate cererile pe ${req.url}`)
    if (!expected || typeof provided !== 'string' || provided.length === 0 || !safeEqual(provided, expected)) {
      await reply.code(401).send({ success: false, error: `Missing or invalid ${header} header` })
    }
  }
}
