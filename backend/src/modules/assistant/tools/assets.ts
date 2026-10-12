import { z } from 'zod/v4'
import { confirmTool, autoTool, type ToolBuildContext } from './shared.js'
import * as assetsService from '../../assets/service.js'

// Tool-uri assets (PLAN.md Track D, Wave 7) — citirile sunt auto; plasarea de ordine e confirm
// (mecanismul existent). Live-ul e blocat suplimentar de kill-switch din service.
export function buildAssetsTools(ctx: ToolBuildContext) {
  return [
    autoTool({
      name: 'asset_price',
      inputSchema: z.object({
        category: z.enum(['stock', 'etf', 'metal']),
        symbol: z.string().min(1).describe('Simbol Finnhub (AAPL) sau Twelve Data pt. metale (XAU/USD)'),
      }),
      description: 'Cotația curentă pt. o acțiune, ETF sau metal (aur/argint).',
      run: ({ category, symbol }) => assetsService.getPrice(category, symbol),
    }),
    autoTool({
      name: 'asset_portfolio',
      inputSchema: z.object({}),
      description: 'Pozițiile curente pe brokerul conectat (Trading212, paper sau live read-only), cu P&L.',
      run: () => assetsService.getPortfolio('trading212'),
    }),
    confirmTool(ctx, {
      name: 'asset_place_order',
      inputSchema: z.object({
        symbol: z.string().min(1).describe('Preview/paper: simbol Finnhub/Twelve Data. Live: ticker Trading212 exact (ex: AAPL_US_EQ)'),
        side: z.enum(['buy', 'sell']),
        type: z.enum(['market', 'limit']).default('market'),
        quantity: z.number().positive(),
        limitPrice: z.number().positive().optional(),
      }),
      description: 'Plasează un ordin pe brokerul conectat (paper sau live, cu kill-switch). Confirmare obligatorie.',
      summarize: (a) =>
        `Ordin ${a.side.toUpperCase()} ${a.quantity} ${a.symbol} (${a.type}${a.limitPrice ? ` la ${a.limitPrice}` : ''}) pe Trading212`,
    }),
  ]
}

export const assetsConfirmExecutors = {
  asset_place_order: (
    input: { symbol: string; side: 'buy' | 'sell'; type: 'market' | 'limit'; quantity: number; limitPrice?: number },
  ) => assetsService.placeOrder({ ...input, broker: 'trading212' }),
}
