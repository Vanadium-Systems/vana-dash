import { eq } from 'drizzle-orm'
import type { FastifyReply, FastifyRequest, onRequestHookHandler } from 'fastify'
import fp from 'fastify-plugin'
import { db } from '../db/client.js'
import { users } from '../db/schema/index.js'
import { safeEqual } from '../lib/crypto.js'
import { actorStore, runWithFreshActor } from '../lib/request-context.js'
import type { SessionUser } from '../lib/session.js'
import { loadSessionUser } from '../lib/session.js'
import { featureForRequest } from './feature-guard.js'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    /** Omul din sesiune, calculat o dată pe request de `authenticate`. */
    me: SessionUser
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    // `sv` = session_version la emiterea tokenului; o sesiune veche (parolă resetată, user
    // dezactivat) primește 401 chiar dacă tokenul nu a expirat.
    payload: { sub: string; sv: number }
    user: { sub: string; sv: number }
  }
}

const LAST_SEEN_MIN_INTERVAL_MS = 60_000

export const authPlugin = fp(async (app) => {
  // Store-ul de actor se deschide aici, înainte de orice rută; `authenticate` îl completează.
  app.addHook('onRequest', (request, _reply, done) => {
    runWithFreshActor({ userId: null, ip: request.ip }, done)
  })

  const authenticate = async (req: FastifyRequest, reply: FastifyReply) => {
    let payload: { sub: string; sv: number }
    try {
      payload = await req.jwtVerify()
    } catch {
      return await reply.code(401).send({ success: false, error: 'Unauthorized' })
    }

    const me = await loadSessionUser(payload.sub)
    if (!me) return await reply.code(401).send({ success: false, error: 'Unauthorized' })
    // Dezactivat sau cu sesiunea invalidată (parolă schimbată/resetată): delogat imediat,
    // fără să aștepte expirarea tokenului. 'invited' nu ajunge aici — n-are încă parolă.
    if (me.status !== 'active' || me.sessionVersion !== payload.sv) {
      return await reply.code(401).send({ success: false, error: 'Unauthorized' })
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
    if (store) store.userId = me.id

    // „Ultima activitate" din pagina Echipă. Cel mult o scriere pe minut și om, ca un poll
    // la 15s să nu devină un UPDATE pe fiecare cerere.
    if (!me.lastSeenAt || Date.now() - me.lastSeenAt.getTime() > LAST_SEEN_MIN_INTERVAL_MS) {
      await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, me.id))
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
