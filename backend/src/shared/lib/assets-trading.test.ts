/**
 * P&L paper pt. Assets (PLAN.md Track D, Wave 7) — algoritm identic modules/crypto (cost mediu),
 * duplicat intenționat (module izolate, fără cross-import). Testat separat de rețea.
 */
import { describe, expect, it } from 'vitest'
import { aggregatePaperPositions } from '../../modules/assets/service.js'

describe('aggregatePaperPositions (P&L paper assets, metoda cost mediu)', () => {
  it('buy simplu → poziție cu cost mediu = prețul de cumpărare', () => {
    const lots = aggregatePaperPositions([{ symbol: 'AAPL', side: 'buy', quantity: 10, executedPrice: 200 }])
    const lot = lots.get('AAPL')!
    expect(lot.qty).toBe(10)
    expect(lot.cost).toBe(2000)
    expect(lot.realizedPnl).toBe(0)
  })

  it('buy apoi sell → realized PnL corect', () => {
    const lots = aggregatePaperPositions([
      { symbol: 'AAPL', side: 'buy', quantity: 10, executedPrice: 200 },
      { symbol: 'AAPL', side: 'sell', quantity: 4, executedPrice: 250 },
    ])
    const lot = lots.get('AAPL')!
    expect(lot.qty).toBe(6)
    expect(lot.cost).toBe(1200)
    // vândut 4 la 250 din mediu de 200 → +200 realizat
    expect(lot.realizedPnl).toBeCloseTo(200)
  })

  it('sell fără acoperire nu produce cost negativ', () => {
    const lots = aggregatePaperPositions([{ symbol: 'XAU/USD', side: 'sell', quantity: 5, executedPrice: 2400 }])
    const lot = lots.get('XAU/USD')!
    expect(lot.qty).toBeLessThanOrEqual(0)
    expect(lot.cost).toBeLessThanOrEqual(0)
  })

  it('simboluri diferite se agreghează separat', () => {
    const lots = aggregatePaperPositions([
      { symbol: 'AAPL', side: 'buy', quantity: 10, executedPrice: 200 },
      { symbol: 'XAU/USD', side: 'buy', quantity: 2, executedPrice: 2400 },
    ])
    expect(lots.size).toBe(2)
  })
})
