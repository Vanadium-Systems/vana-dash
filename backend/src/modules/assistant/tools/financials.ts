import { z } from 'zod/v4'
import * as financialsService from '../../financials/service.js'
import { resolvePeriod } from '../../../shared/lib/period.js'
import { autoTool } from './shared.js'

const periodShape = {
  period: z.enum(['7d', '30d', '90d', 'mtd', 'ytd']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
}

export function buildFinancialsTools() {
  return [
    autoTool({
      name: 'get_pnl',
      inputSchema: z.object(periodShape),
      description: 'Profit & Loss (venituri, cheltuieli, profit net) pentru o perioadă.',
      run: (a) => financialsService.getPnl(resolvePeriod(a.period, a.from, a.to)),
    }),
    autoTool({
      name: 'get_recurring_revenue',
      inputSchema: z.object({}),
      description: 'Venituri recurente (MRR-like) curente.',
      run: () => financialsService.getRecurringRevenue(),
    }),
    autoTool({
      name: 'get_recurring_expenses_monthly',
      inputSchema: z.object({}),
      description: 'Cheltuieli recurente lunare curente.',
      run: () => financialsService.getRecurringExpensesMonthly(),
    }),
    autoTool({
      name: 'get_exchange_rate_history',
      inputSchema: z.object({
        currency: z.enum(['EUR', 'USD']),
        period: z.enum(['daily', 'monthly', 'yearly']).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
      }),
      description: 'Istoric curs BNR pentru EUR/USD.',
      run: (a) => financialsService.getExchangeRateHistory({ period: 'daily', ...a }),
    }),
    autoTool({
      name: 'get_cashflow',
      inputSchema: z.object(periodShape),
      description: 'Cash flow (intrări/ieșiri de numerar) pentru o perioadă.',
      run: (a) => financialsService.getCashflow(resolvePeriod(a.period, a.from, a.to)),
    }),
  ]
}
