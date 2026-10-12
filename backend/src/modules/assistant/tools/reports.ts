import { z } from 'zod/v4'
import * as reportsService from '../../reports/service.js'
import { autoTool } from './shared.js'

export function buildReportsTools() {
  return [
    autoTool({
      name: 'get_mrr_trend',
      inputSchema: z.object({ from: z.string(), to: z.string() }),
      description: 'Trend MRR (venit recurent lunar) între două date.',
      run: (a) => reportsService.getMrrTrend({ from: new Date(a.from), to: new Date(a.to) }),
    }),
    autoTool({
      name: 'get_period_comparison',
      inputSchema: z.object({ fromA: z.string(), toA: z.string(), fromB: z.string(), toB: z.string() }),
      description: 'Comparație între două perioade (ex. luna asta vs luna trecută).',
      run: (a) =>
        reportsService.getPeriodComparison({
          fromA: new Date(a.fromA),
          toA: new Date(a.toA),
          fromB: new Date(a.fromB),
          toB: new Date(a.toB),
        }),
    }),
    autoTool({
      name: 'get_expense_breakdown_trend',
      inputSchema: z.object({ from: z.string(), to: z.string() }),
      description: 'Distribuția cheltuielilor pe categorii, în timp.',
      run: (a) => reportsService.getExpenseBreakdownTrend({ from: new Date(a.from), to: new Date(a.to) }),
    }),
    autoTool({
      name: 'get_monthly_snapshot',
      inputSchema: z.object({ month: z.string() }),
      description: 'Raport lunar complet (format YYYY-MM).',
      run: (a) => reportsService.getMonthlySnapshot(a),
    }),
  ]
}
