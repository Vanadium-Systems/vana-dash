import { z } from 'zod/v4'
import { confirmTool, autoTool, type ToolBuildContext } from './shared.js'
import * as cryptoService from '../../crypto/service.js'
import * as coingecko from '../../crypto/coingecko.js'

// Tool-uri crypto (PLAN.md Contract D) — citirile sunt auto; plasarea de ordine e confirm
// (mecanismul existent). Live-ul e blocat suplimentar de kill-switch din service.
export function buildCryptoTools(ctx: ToolBuildContext) {
  return [
    autoTool({
      name: 'crypto_price',
      inputSchema: z.object({
        ids: z.array(z.string().min(1)).min(1).max(20).describe('Id-uri CoinGecko (ex: bitcoin, ethereum)'),
      }),
      description: 'Prețuri USD curente pt. coinuri CoinGecko.',
      run: async ({ ids }) => {
        const prices = await coingecko.simplePrice(ids)
        return Object.entries(prices).map(([id, p]) => ({
          id,
          priceUsd: p.usd,
          change24hPct: p.usd_24h_change ?? null,
        }))
      },
    }),
    autoTool({
      name: 'crypto_portfolio',
      inputSchema: z.object({
        exchange: z.enum(['binance', 'binance_testnet']).default('binance'),
      }),
      description: 'Pozițiile curente pe exchange-ul conectat (paper sau live read-only), cu P&L.',
      run: (a) => cryptoService.getPortfolio(a.exchange),
    }),
    confirmTool(ctx, {
      name: 'crypto_place_order',
      inputSchema: z.object({
        exchange: z.enum(['binance', 'binance_testnet']).default('binance'),
        symbol: z.string().regex(/^[A-Z0-9]{5,20}$/).describe('Perechea Binance (ex: BTCUSDT)'),
        side: z.enum(['buy', 'sell']),
        type: z.enum(['market', 'limit']).default('market'),
        quantity: z.number().positive().describe('Cantitatea în asset-ul de bază'),
        limitPrice: z.number().positive().optional(),
      }),
      description:
        'Plasează un ordin pe exchange-ul conectat (paper sau live, cu kill-switch). Confirmare obligatorie.',
      summarize: (a) =>
        `Ordin ${a.side.toUpperCase()} ${a.quantity} ${a.symbol} (${a.type}${a.limitPrice ? ` la ${a.limitPrice}` : ''}) pe ${a.exchange}`,
    }),
  ]
}

export const cryptoConfirmExecutors = {
  crypto_place_order: (
    input: {
      exchange: 'binance' | 'binance_testnet'
      symbol: string
      side: 'buy' | 'sell'
      type: 'market' | 'limit'
      quantity: number
      limitPrice?: number
    },
  ) => cryptoService.placeOrder(input),
}
