import type { PlatformConfig, PlatformConnector, PlatformHealth, PlatformMetric, PlatformOpsSignals } from '../types.js'
import { transformMetrics, transformOpsSignals } from './transform.js'
import type { VanagreenHealthSignalsResponse, VanagreenMetricsResponse } from './types.js'

const FETCH_TIMEOUT_MS = 15_000

export const vanagreenConnector: PlatformConnector = {
  type: 'vanagreen',
  displayName: 'VanaGreen',

  // Endpoint-ul vanagreen e snapshot-based (starea curentă), deci from/to nu se aplică.
  async fetchMetrics(config: PlatformConfig, _from: Date, _to: Date): Promise<PlatformMetric[]> {
    const res = await fetch(`${config.apiUrl}/api/v1/platform/metrics`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`vanagreen metrics endpoint returned ${res.status}`)
    const payload = (await res.json()) as VanagreenMetricsResponse
    return transformMetrics(payload)
  },

  async checkHealth(config: PlatformConfig): Promise<PlatformHealth> {
    const startedAt = Date.now()
    try {
      const res = await fetch(`${config.apiUrl}/health`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      const latencyMs = Date.now() - startedAt
      if (!res.ok) return { status: 'degraded', latencyMs, message: `HTTP ${res.status}` }
      return { status: 'healthy', latencyMs }
    } catch (err) {
      return { status: 'down', message: String(err) }
    }
  },

  async fetchOpsSignals(config: PlatformConfig): Promise<PlatformOpsSignals> {
    const res = await fetch(`${config.apiUrl}/api/v1/platform/health-signals`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`vanagreen health-signals endpoint returned ${res.status}`)
    const payload = (await res.json()) as VanagreenHealthSignalsResponse
    return transformOpsSignals(payload)
  },
}
