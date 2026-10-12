import type { PlatformConfig, PlatformConnector, PlatformHealth, PlatformMetric } from '../types.js'
import type { GenericMetricMapping } from './types.js'

const FETCH_TIMEOUT_MS = 15_000

/** Desparte '/cale.json#.a.b' în rută și calea JSON punctată (# cu sau fără punct inițial). */
function splitPath(path: string): { route: string; jsonPath: string | null } {
  const hashIndex = path.indexOf('#')
  if (hashIndex === -1) return { route: path, jsonPath: null }
  return { route: path.slice(0, hashIndex), jsonPath: path.slice(hashIndex + 1).replace(/^\./, '') || null }
}

function extractNumber(payload: unknown, jsonPath: string | null): number {
  let current: unknown = payload
  if (jsonPath) {
    for (const segment of jsonPath.split('.')) {
      if (current === null || typeof current !== 'object') throw new Error(`Cale JSON '${jsonPath}' nu există în răspuns`)
      current = (current as Record<string, unknown>)[segment]
    }
  }
  let numeric = NaN
  if (typeof current === 'number') {
    numeric = current
  } else if (typeof current === 'object' && current !== null && typeof (current as Record<string, unknown>).value === 'number') {
    numeric = (current as Record<string, unknown>).value as number
  }
  if (!Number.isFinite(numeric)) {
    throw new Error(`Răspunsul de la '${jsonPath ?? '(rădăcină)'}' nu conține un număr`)
  }
  return numeric
}

function validMappings(config: PlatformConfig): GenericMetricMapping[] {
  const mappings = Array.isArray(config.metricMappings) ? config.metricMappings : []
  return mappings.filter(
    (m): m is GenericMetricMapping => Boolean(m) && typeof m.metricKey === 'string' && typeof m.path === 'string' && m.path.startsWith('/'),
  )
}

export const genericConnector: PlatformConnector = {
  type: 'generic',
  displayName: 'Generic (API propriu)',

  // Snapshot-based ca vanagreen — fiecare mapare face propriul GET, recordedAt e momentul fetch.
  async fetchMetrics(config: PlatformConfig): Promise<PlatformMetric[]> {
    const metrics: PlatformMetric[] = []
    for (const mapping of validMappings(config)) {
      const { route, jsonPath } = splitPath(mapping.path)
      const res = await fetch(`${config.apiUrl}${route}`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`generic ${mapping.path} returned ${res.status}`)
      const payload: unknown = await res.json()
      metrics.push({
        metricKey: mapping.metricKey,
        value: extractNumber(payload, jsonPath),
        unit: mapping.unit,
        recordedAt: new Date(),
      })
    }
    return metrics
  },

  async checkHealth(config: PlatformConfig): Promise<PlatformHealth> {
    const startedAt = Date.now()
    try {
      const route = splitPath(config.healthPath ?? '/').route
      const res = await fetch(`${config.apiUrl}${route}`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      const latencyMs = Date.now() - startedAt
      if (!res.ok) return { status: 'degraded', latencyMs, message: `HTTP ${res.status}` }
      return { status: 'healthy', latencyMs }
    } catch (err) {
      return { status: 'down', message: String(err) }
    }
  },
}
