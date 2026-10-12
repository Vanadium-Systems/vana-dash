/**
 * Client Binance (PLAN.md Contract D) — vector HMAC cunoscut, semnătura e pură (fără rețea).
 */
import { describe, expect, it } from 'vitest'
import { signQuery } from '../../modules/crypto/binance.js'
import { aggregatePaperPositions } from '../../modules/crypto/service.js'

describe('signQuery', () => {
  it('produce HMAC-SHA256 hex pe un query cunoscut', () => {
    expect(signQuery('symbol=BTCUSDT&side=BUY&type=MARKET&quantity=0.001&timestamp=1756200000000', 'secret-key-for-test')).toBe(
      'f7f7e87279d2293d21193d911b666d2e576781edbc717b72a7703ee3cca679c4',
    )
  })
})

describe('aggregatePaperPositions (P&L paper, metoda cost mediu)', () => {
  it('buy simplu → poziție cu cost mediu = prețul de cumpărare', () => {
    const lots = aggregatePaperPositions([
      { symbol: 'BTCUSDT', side: 'buy', quantity: 1, executedPrice: 100_000 },
    ])
    const lot = lots.get('BTCUSDT')!
    expect(lot.qty).toBe(1)
    expect(lot.cost).toBe(100_000)
    expect(lot.realizedPnl).toBe(0)
  })

  it('buy apoi sell → realized PnL corect', () => {
    const lots = aggregatePaperPositions([
      { symbol: 'BTCUSDT', side: 'buy', quantity: 2, executedPrice: 50_000 },
      { symbol: 'BTCUSDT', side: 'sell', quantity: 1, executedPrice: 60_000 },
    ])
    const lot = lots.get('BTCUSDT')!
    expect(lot.qty).toBe(1)
    expect(lot.cost).toBe(50_000)
    // vândut 1 la 60k din mediu de 50k → +10k realizat
    expect(lot.realizedPnl).toBeCloseTo(10_000)
  })

  it('sell fără acoperire nu produce cost negativ', () => {
    const lots = aggregatePaperPositions([
      { symbol: 'ETHUSDT', side: 'sell', quantity: 5, executedPrice: 3_000 },
    ])
    const lot = lots.get('ETHUSDT')!
    expect(lot.qty).toBeLessThanOrEqual(0)
    expect(lot.cost).toBeLessThanOrEqual(0)
  })

  it('simboluri diferite se agreghează separat', () => {
    const lots = aggregatePaperPositions([
      { symbol: 'BTCUSDT', side: 'buy', quantity: 1, executedPrice: 100_000 },
      { symbol: 'SOLUSDT', side: 'buy', quantity: 10, executedPrice: 150 },
    ])
    expect(lots.size).toBe(2)
  })
})
