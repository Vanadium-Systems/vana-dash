import { z } from 'zod'
import type { FeatureGuard, RouteSchemas } from '../../shared/middleware/feature-guard.js'
import { isPathDeniedToTokens } from '../../shared/lib/api-tokens.js'

export interface RouteInfo {
  method: string
  path: string
  /** The feature the route needs; null = the person's own (`self`). */
  feature: string | null
  body?: unknown
  query?: unknown
  params?: unknown
}

function toJsonSchema(schema: unknown): unknown {
  if (!(schema instanceof z.ZodType)) return undefined
  try {
    return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })
  } catch {
    // A schema with a refinement JSON Schema cannot express: the route still shows, without it.
    return undefined
  }
}

/**
 * The routes the caller can actually call: features they have (narrowed by the token, when the
 * request came with one) and, through a token, not the paths refused to tokens. Built from the
 * same map the guard enforces, so it cannot list a route the guard would refuse.
 */
export function listCallableRoutes(
  guard: FeatureGuard,
  features: string[],
  viaToken: boolean,
  filter?: string,
): RouteInfo[] {
  const granted = new Set(features)
  const needle = filter?.trim().toLowerCase()
  const out: RouteInfo[] = []
  for (const [key, feature] of guard.routes) {
    const [method, path] = key.split(' ') as [string, string]
    if (feature && !granted.has(feature)) continue
    if (viaToken && isPathDeniedToTokens(method, path)) continue
    if (needle && !path.toLowerCase().includes(needle) && !(feature ?? '').includes(needle)) continue
    const schemas: RouteSchemas = guard.schemas.get(key) ?? {}
    out.push({
      method,
      path,
      feature,
      body: toJsonSchema(schemas.body),
      query: toJsonSchema(schemas.querystring),
      params: toJsonSchema(schemas.params),
    })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
}
