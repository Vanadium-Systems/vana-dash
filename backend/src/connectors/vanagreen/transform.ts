import type { PlatformMetric, PlatformOpsSignals } from '../types.js'
import type { VanagreenHealthSignalsResponse, VanagreenMetricsResponse } from './types.js'

// Mapare răspuns vanagreen → metric keys standard vana-dash (docs/METRIC_KEYS.md).
// recordedAt e trunchiat la începutul zilei: sync-urile repetate din aceeași zi
// UPSERT-ează același punct, deci păstrăm un punct pe zi per metrică.
//
// Sprint C, Track B: `revenue`/`mrr`/`vanagreen.mrr_eur` NU mai vin de-aici — sursa
// lor din vanagreen (tenant_payments/subscription_price_*) a fost ștearsă, banii
// stau acum integral în vana-dash (billing_clients + financial_records). Vezi
// modules/financials/service.ts pt. mrr calculat local din billing_clients.
//
// Sprint D, Track 1: `active_tenants` a fost redefinit în vanagreen (exclude isDemo
// acum) — nicio schimbare de cod aici, doar valoarea din upstream se schimbă.
// `demo_tenants` e nou, mapat separat ca `vanagreen.demo_clients`.
export function transformMetrics(payload: VanagreenMetricsResponse): PlatformMetric[] {
  const recordedAt = startOfDay(new Date(payload.generated_at))
  const m = payload.metrics

  return [
    { metricKey: 'active_clients', value: m.active_tenants, unit: 'count', recordedAt },
    { metricKey: 'vanagreen.demo_clients', value: m.demo_tenants, unit: 'count', recordedAt },
    { metricKey: 'user_count', value: m.user_count, unit: 'count', recordedAt },
    { metricKey: 'collection_count', value: m.collections_this_month, unit: 'count', recordedAt },
    { metricKey: 'vanagreen.inactive_tenants', value: m.inactive_tenants, unit: 'count', recordedAt },
    { metricKey: 'vanagreen.outgoing_this_month', value: m.outgoing_this_month, unit: 'count', recordedAt },
    { metricKey: 'vanagreen.storage_bytes', value: m.storage_bytes, unit: 'bytes', recordedAt },
  ]
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// Mapare răspuns GET /api/v1/platform/health-signals → PlatformOpsSignals (Feature 2,
// PLAN.md 2026-07-25). Shape identic cu `/api/monitoring/health-signals` propriu vana-dash.
export function transformOpsSignals(payload: VanagreenHealthSignalsResponse): PlatformOpsSignals {
  return {
    generatedAt: new Date(payload.generated_at),
    signals: payload.signals.map((s) => ({
      key: s.key,
      label: s.label,
      level: s.level,
      value: s.value,
      unit: s.unit,
      detail: s.detail,
    })),
    history: payload.history.map((h) => ({
      capturedAt: new Date(h.captured_at),
      cpuPct: h.cpu_pct,
      ramPct: h.ram_pct,
      diskPct: h.disk_pct,
    })),
  }
}
