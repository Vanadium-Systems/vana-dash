import { describe, expect, it } from 'vitest'
import { transformMetrics, transformOpsSignals } from './transform.js'
import type { VanagreenHealthSignalsResponse, VanagreenMetricsResponse } from './types.js'

const payload: VanagreenMetricsResponse = {
  generated_at: '2026-07-04T14:33:21.000Z',
  metrics: {
    active_tenants: 12,
    demo_tenants: 4,
    inactive_tenants: 3,
    user_count: 47,
    collections_this_month: 210,
    outgoing_this_month: 34,
    storage_bytes: 123456789,
  },
}

describe('vanagreen transform', () => {
  it('maps to standard metric keys', () => {
    const metrics = transformMetrics(payload)
    const byKey = new Map(metrics.map((m) => [m.metricKey, m]))

    expect(byKey.get('active_clients')?.value).toBe(12)
    expect(byKey.get('vanagreen.demo_clients')?.value).toBe(4)
    expect(byKey.get('user_count')?.value).toBe(47)
    expect(byKey.get('collection_count')?.value).toBe(210)
    // Sprint C, Track B: revenue/mrr nu mai vin din vanagreen (vezi financials/service.ts).
    expect(byKey.has('revenue')).toBe(false)
    expect(byKey.has('mrr')).toBe(false)
  })

  it('prefixes vanagreen-specific keys', () => {
    const metrics = transformMetrics(payload)
    const custom = metrics.filter((m) => m.metricKey.startsWith('vanagreen.'))
    expect(custom.map((m) => m.metricKey).sort()).toEqual([
      'vanagreen.demo_clients',
      'vanagreen.inactive_tenants',
      'vanagreen.outgoing_this_month',
      'vanagreen.storage_bytes',
    ])
  })

  it('truncates recordedAt to start of day so intra-day syncs upsert the same point', () => {
    const metrics = transformMetrics(payload)
    for (const m of metrics) {
      expect(m.recordedAt.getHours()).toBe(0)
      expect(m.recordedAt.getMinutes()).toBe(0)
      expect(m.recordedAt.getSeconds()).toBe(0)
    }
    // Toate metricile din același payload au același timestamp
    expect(new Set(metrics.map((m) => m.recordedAt.getTime())).size).toBe(1)
  })
})

describe('vanagreen transformOpsSignals', () => {
  const opsPayload: VanagreenHealthSignalsResponse = {
    generated_at: '2026-07-25T10:00:00.000Z',
    signals: [
      { key: 'cpu', label: 'CPU host', level: 'green', value: 12.3, unit: 'pct', detail: '12.3%' },
      { key: 'document_failures', label: 'Documente eșuate', level: 'red', value: 3, unit: 'count', detail: '3 eșuate azi' },
    ],
    history: [{ captured_at: '2026-07-24T10:00:00.000Z', cpu_pct: 10, ram_pct: 40, disk_pct: 55 }],
  }

  it('mapează semnalele snake_case → camelCase, păstrând key/level/unit/detail', () => {
    const result = transformOpsSignals(opsPayload)
    expect(result.signals).toHaveLength(2)
    expect(result.signals[0]).toEqual({ key: 'cpu', label: 'CPU host', level: 'green', value: 12.3, unit: 'pct', detail: '12.3%' })
    expect(result.signals[1]?.level).toBe('red')
  })

  it('mapează history (capturedAt/cpuPct/ramPct/diskPct)', () => {
    const result = transformOpsSignals(opsPayload)
    expect(result.history).toHaveLength(1)
    expect(result.history[0]).toEqual({ capturedAt: new Date('2026-07-24T10:00:00.000Z'), cpuPct: 10, ramPct: 40, diskPct: 55 })
  })

  it('parsează generatedAt ca Date', () => {
    const result = transformOpsSignals(opsPayload)
    expect(result.generatedAt).toEqual(new Date('2026-07-25T10:00:00.000Z'))
  })
})
