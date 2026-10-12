// Mapările metrică→rută ale conectorului generic (sprint de-hardcodare 2026-08-25).
// Stocate pe platforms.metric_mappings (jsonb), editabile din UI fără cod.
export const GENERIC_METRIC_KINDS = ['number'] as const

export interface GenericMetricMapping {
  metricKey: string
  unit?: string
  /** Rută relativă pe API-ul platformei (începe cu '/'), ex: '/api/stats'. Opțional un
   *  fragment '#cale.punctata' care extrage valoarea din JSON-ul de răspuns,
   *  ex: '/stats.json#.metrics.revenue'. Fără '#', răspunsul trebuie să fie numărul
   *  însuși sau un obiect { value: <number> }. */
  path: string
  kind: (typeof GENERIC_METRIC_KINDS)[number]
}
