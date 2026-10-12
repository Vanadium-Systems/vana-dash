import { describe, expect, it } from 'vitest'
import { computeSpamScore } from './email-spam-heuristic.js'

const KEYWORDS = ['click here', 'you have won']

describe('computeSpamScore', () => {
  it('scor 0 pt. un email normal de la un sender cunoscut', () => {
    const result = computeSpamScore(
      { fromKnownBefore: true, subject: 'Factura de luna asta', bodyText: 'Salut, atașat factura.', keywords: KEYWORDS },
      4,
    )
    expect(result.score).toBe(0)
    expect(result.isSpam).toBe(false)
  })

  it('sender nou (+2) nu ajunge singur la prag implicit (4)', () => {
    const result = computeSpamScore(
      { fromKnownBefore: false, subject: 'Salut', bodyText: 'Primul nostru contact.', keywords: KEYWORDS },
      4,
    )
    expect(result.score).toBe(2)
    expect(result.isSpam).toBe(false)
  })

  it('cuvânt-cheie de spam (+2) + sender nou (+2) trece pragul', () => {
    const result = computeSpamScore(
      { fromKnownBefore: false, subject: 'You have won a prize!', bodyText: 'Click here to claim.', keywords: KEYWORDS },
      4,
    )
    expect(result.score).toBeGreaterThanOrEqual(4)
    expect(result.isSpam).toBe(true)
  })

  it('linkuri cu TLD suspect adaugă puncte, plafonate la +3', () => {
    const manyLinks = Array.from({ length: 5 }, (_, i) => `http://spam${i}.xyz/offer`).join(' ')
    const result = computeSpamScore({ fromKnownBefore: true, subject: 'Oferta', bodyText: manyLinks, keywords: [] }, 4)
    // 5 linkuri suspecte ar da +5 fără plafon — verificăm plafonul de +3
    expect(result.score).toBe(3)
  })

  it('subiect ALL CAPS adaugă +1', () => {
    const result = computeSpamScore(
      { fromKnownBefore: true, subject: 'URGENT ACTION REQUIRED NOW', bodyText: null, keywords: [] },
      4,
    )
    expect(result.score).toBe(1)
  })

  it('subiect scurt sau fără litere nu declanșează fals-pozitiv ALL CAPS', () => {
    const result = computeSpamScore({ fromKnownBefore: true, subject: 'OK', bodyText: null, keywords: [] }, 4)
    expect(result.score).toBe(0)
  })

  it('prag configurabil — același scor, praguri diferite', () => {
    const input = { fromKnownBefore: false, subject: 'Salut', bodyText: null, keywords: KEYWORDS }
    expect(computeSpamScore(input, 1).isSpam).toBe(true)
    expect(computeSpamScore(input, 10).isSpam).toBe(false)
  })
})
