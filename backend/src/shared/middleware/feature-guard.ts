import type { FastifyInstance, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'
import {
  assertCatalogCoversRoutes,
  assertOpenRoutesAreDeclared,
  declaredRouteKind,
  resolveFeatureKeys,
  type CatalogProblem,
  type RouteDescriptor,
} from '../lib/features.js'

export interface FeatureGuard {
  /** `METHOD /url` → cheia funcționalității, sau null pentru `self` (al omului, nu al rolului). */
  routes: Map<string, string | null>
  /** Rutele autentificate, pentru testul care tipărește maparea completă. */
  authenticated: RouteDescriptor[]
  /** Routes registered without `authenticate`; each must be declared `public` or `machine`. */
  open: RouteDescriptor[]
  problems: CatalogProblem[]
}

declare module 'fastify' {
  interface FastifyInstance {
    featureGuard: FeatureGuard
  }
}

const routeKey = (method: string, url: string) => `${method.toUpperCase()} ${url}`

/**
 * Leagă fiecare rută autentificată de funcționalitatea ei (PLAN.md C2, BE-1).
 *
 * Două lucruri se întâmplă aici:
 * 1. La `onRoute` se rezolvă funcționalitatea și se reține într-o hartă. O rută care nu se
 *    rezolvă — sau care se rezolvă la două funcționalității — e strânsă ca problemă, nu
 *    trecută sub tăcere.
 * 2. La `onReady` lista de probleme oprește pornirea serverului. Deci o rută nouă nu poate
 *    ajunge în producție fără o decizie explicită despre cine o vede.
 *
 * Refuzul în request vine în `authenticate` (auth.ts), unde funcționalitățile omului sunt deja
 * calculate — aici n-avem încă cine e omul.
 */
export const featureGuardPlugin = fp(async (app: FastifyInstance) => {
  const guard: FeatureGuard = { routes: new Map(), authenticated: [], open: [], problems: [] }
  app.decorate('featureGuard', guard)

  app.addHook('onRoute', (route) => {
    const isAuthenticated = [route.preHandler ?? [], route.preValidation ?? []]
      .flat()
      .flat()
      .includes(app.authenticate)
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    for (const method of methods) {
      if (method === 'HEAD' || method === 'OPTIONS') continue
      if (!isAuthenticated) {
        guard.open.push({ method, url: route.url })
        continue
      }
      guard.authenticated.push({ method, url: route.url })
      if (declaredRouteKind(method, route.url)) {
        guard.routes.set(routeKey(method, route.url), null)
        continue
      }
      const keys = resolveFeatureKeys(method, route.url)
      if (keys.length === 1) {
        guard.routes.set(routeKey(method, route.url), keys[0] as string)
        continue
      }
      guard.problems.push({
        method,
        url: route.url,
        reason: keys.length === 0 ? 'unmapped' : 'ambiguous',
        keys: [...keys].sort(),
      })
    }
  })

  app.addHook('onReady', async () => {
    // Rulele încă neclonate (adăugate după ready, caz rar) se verifică și ele.
    guard.problems = [...assertCatalogCoversRoutes(guard.authenticated), ...assertOpenRoutesAreDeclared(guard.open)]
    if (guard.problems.length > 0) {
      const label = { unmapped: 'no feature', ambiguous: 'ambiguous', open: 'no authenticate, not declared public/machine' }
      const detail = guard.problems
        .map((p) => `  ${label[p.reason]}: ${p.method} ${p.url}${p.keys.length ? ` → ${p.keys.join(', ')}` : ''}`)
        .join('\n')
      throw new Error(
        `The feature catalog does not cover every route (${guard.problems.length}). ` +
          `Add the entry in shared/lib/features.ts or declare the route self/public/machine:\n${detail}`,
      )
    }
  })
})

/** Funcționalitatea cerută de ruta curentă, sau null dacă nu cere una (self). */
export function featureForRequest(req: FastifyRequest, guard: FeatureGuard): string | null {
  const url = req.routeOptions.url
  if (!url) return null
  return guard.routes.get(routeKey(req.method, url)) ?? null
}
