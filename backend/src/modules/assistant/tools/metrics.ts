import { z } from 'zod/v4'
import * as metricsService from '../../metrics/service.js'
import { resolvePeriod } from '../../../shared/lib/period.js'
import { autoTool } from './shared.js'

const periodShape = {
  period: z.enum(['7d', '30d', '90d', 'mtd', 'ytd']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  platformId: z.string().optional(),
}

export function buildMetricsTools() {
  return [
    autoTool({
      name: 'get_metrics_summary',
      inputSchema: z.object(periodShape),
      description: 'Sumarul KPI-urilor (revenue, clienți activi, etc.) pentru o perioadă, opțional filtrat pe platformă.',
      run: (a) => metricsService.getSummary(resolvePeriod(a.period, a.from, a.to), a.platformId),
    }),
    autoTool({
      name: 'get_metrics_series',
      inputSchema: z.object({ ...periodShape, metricKey: z.string().min(1) }),
      description: 'Seria time-series pentru un metric key anume (ex. revenue, mrr), pentru grafic/analiză.',
      run: (a) => metricsService.getSeries(a.metricKey, resolvePeriod(a.period, a.from, a.to), a.platformId),
    }),
  ]
}
