// Formatul răspunsului de la GET /api/v1/platform/metrics din vanagreen.
// Sprint C, Track B: mrr_lei/mrr_eur/revenue_this_month_lei au dispărut din
// vanagreen — sursa lor (tenant_payments/subscription_price_*) a fost mutată
// integral în vana-dash (billing_clients). Vezi financials/service.ts pt. mrr nou.
export interface VanagreenMetricsResponse {
  generated_at: string
  metrics: {
    active_tenants: number
    demo_tenants: number
    inactive_tenants: number
    user_count: number
    collections_this_month: number
    outgoing_this_month: number
    storage_bytes: number
  }
}

/**
 * Formatul răspunsului de la GET /api/v1/platform/health-signals (contract nou, vezi PLAN.md
 * Feature 2 — dependință cross-repo). Shape identic cu `/api/monitoring/health-signals` propriu
 * vana-dash (`modules/monitoring/routes.ts`), pt. că handler-ul din recyclers_app reutilizează
 * ACELAȘI `getHealthSignalsSummary()` — doar montat pe ruta nouă, cu auth API-key în loc de sesiune.
 */
export interface VanagreenHealthSignalsResponse {
  generated_at: string
  signals: Array<{
    key: string
    label: string
    level: 'green' | 'yellow' | 'red'
    value: number | null
    unit: 'pct' | 'count' | 'hours' | 'queued'
    detail: string
  }>
  history: Array<{
    captured_at: string
    cpu_pct: number
    ram_pct: number
    disk_pct: number
  }>
}
