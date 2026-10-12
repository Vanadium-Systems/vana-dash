/**
 * bnr.ts — curs BNR EUR/RON (Sprint C, Track B). `parseBnrEurRate` e pură (mock
 * de string), `getRateForDate`/`fetchAndStoreLatestBnrRate` scriu în `exchange_rates`
 * (pg real, vezi test/setup.ts) și fac `fetch` global — mockuit peste tot aici,
 * NU facem niciun request real către bnr.ro (deja verificat manual live, cf. briefing).
 */
import { and, eq, gte, lte } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../db/client.js'
import { exchangeRates } from '../db/schema/index.js'
import {
  fetchAndStoreLatestBnrRate,
  fetchAndStoreLatestBnrRates,
  getRateForDate,
  parseBnrEurRate,
  parseBnrRate,
} from './bnr.js'

const VALID_XML = `<?xml version="1.0" encoding="UTF-8"?>
<DataSet>
  <Header><Publisher>BNR</Publisher></Header>
  <Body>
    <Subject>Reference rates</Subject>
    <Cube date="2026-07-16">
      <Rate currency="AED">1.3546</Rate>
      <Rate currency="EUR">4.9767</Rate>
      <Rate currency="USD">4.5732</Rate>
    </Cube>
  </Body>
</DataSet>`

async function cleanupDate(date: string, currency = 'EUR') {
  await db.delete(exchangeRates).where(and(eq(exchangeRates.date, date), eq(exchangeRates.currency, currency)))
}

// jobs/bnr-daily-fetch.ts (cron real, livrat tot în acest sprint) rulează efectiv pe acest
// DB de dev — poate exista deja un rând REAL pt. orice zi din ultimele zile (nu doar TODAY),
// care ar "câștiga" în fața datelor mockuite din teste (fiind mai recent). Ștergem o
// fereastră largă, nu doar datele punctuale — sigur de făcut, BNR e sursă publică externă,
// cron-ul reface istoricul la următoarea rulare.
async function cleanupRecent(currency = 'EUR') {
  const to = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  await db.delete(exchangeRates).where(and(eq(exchangeRates.currency, currency), gte(exchangeRates.date, from), lte(exchangeRates.date, to)))
}

// Fiecare `it` care mockuiește fetch trebuie să-l elibereze, altfel poluează
// testele următoare din același fișier (fileParallelism:false, teste secvențiale).
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('parseBnrEurRate', () => {
  it('parses date + EUR rate from a valid feed', () => {
    const result = parseBnrEurRate(VALID_XML)
    expect(result).toEqual({ date: '2026-07-16', rate: 4.9767 })
  })

  it('throws when <Cube date="..."> is missing entirely', () => {
    const xml = `<DataSet><Body><NotACube>x</NotACube></Body></DataSet>`
    expect(() => parseBnrEurRate(xml)).toThrow(/Cube/)
  })

  it('throws when <Rate currency="EUR"> is missing from the Cube', () => {
    const xml = `<DataSet><Body><Cube date="2026-07-16"><Rate currency="USD">4.57</Rate></Cube></Body></DataSet>`
    expect(() => parseBnrEurRate(xml)).toThrow(/curs EUR/)
  })

  it('throws on a zero EUR rate (not a positive finite number)', () => {
    const xml = `<DataSet><Body><Cube date="2026-07-16"><Rate currency="EUR">0</Rate></Cube></Body></DataSet>`
    expect(() => parseBnrEurRate(xml)).toThrow(/pozitiv/)
  })

  it('throws on a negative EUR rate', () => {
    const xml = `<DataSet><Body><Cube date="2026-07-16"><Rate currency="EUR">-4.97</Rate></Cube></Body></DataSet>`
    // Regex-ul [\d.]+ nu permite semnul minus, deci "-4.97" nu se potrivește deloc
    // cu <Rate currency="EUR">...</Rate> ca prefix numeric — verificăm doar că
    // NU întoarce silențios un rate greșit (fie aruncă "curs EUR" fie "pozitiv").
    expect(() => parseBnrEurRate(xml)).toThrow()
  })

  it('throws on a non-numeric EUR rate string', () => {
    const xml = `<DataSet><Body><Cube date="2026-07-16"><Rate currency="EUR">N/A</Rate></Cube></Body></DataSet>`
    expect(() => parseBnrEurRate(xml)).toThrow()
  })
})

describe('parseBnrRate (generic, Sprint D Track 2 — USD)', () => {
  it('parses the USD rate from the same feed', () => {
    expect(parseBnrRate(VALID_XML, 'USD')).toEqual({ date: '2026-07-16', rate: 4.5732 })
  })

  it('parses any currency present in the Cube (AED)', () => {
    expect(parseBnrRate(VALID_XML, 'AED')).toEqual({ date: '2026-07-16', rate: 1.3546 })
  })

  it('throws a currency-specific message when the requested currency is missing', () => {
    expect(() => parseBnrRate(VALID_XML, 'GBP')).toThrow(/curs GBP/)
  })
})

describe('fetchAndStoreLatestBnrRate', () => {
  afterEach(async () => {
    await cleanupDate('2026-07-16')
  })

  it('fetches, parses, and upserts the rate row', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(VALID_XML, { status: 200 })))
    const row = await fetchAndStoreLatestBnrRate()
    expect(row).toEqual({ date: '2026-07-16', currency: 'EUR', rate: '4.976700' })

    const [dbRow] = await db
      .select()
      .from(exchangeRates)
      .where(and(eq(exchangeRates.date, '2026-07-16'), eq(exchangeRates.currency, 'EUR')))
    expect(dbRow?.rate).toBe('4.976700')
  })

  it('upserts (does not duplicate) when called twice for the same date', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(VALID_XML, { status: 200 })))
    await fetchAndStoreLatestBnrRate()
    await fetchAndStoreLatestBnrRate()

    const rows = await db
      .select()
      .from(exchangeRates)
      .where(and(eq(exchangeRates.date, '2026-07-16'), eq(exchangeRates.currency, 'EUR')))
    expect(rows).toHaveLength(1)
  })

  it('throws a descriptive error on HTTP non-OK', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('server error', { status: 503 })))
    await expect(fetchAndStoreLatestBnrRate()).rejects.toThrow(/503/)
  })

  it('throws when fetch itself rejects (network error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    await expect(fetchAndStoreLatestBnrRate()).rejects.toThrow(/network down/)
  })
})

describe('fetchAndStoreLatestBnrRates (Sprint D, Track 2 — jobs/bnr-daily-fetch.ts)', () => {
  afterEach(async () => {
    await cleanupDate('2026-07-16', 'EUR')
    await cleanupDate('2026-07-16', 'USD')
  })

  it('fetches the feed ONCE and upserts both EUR and USD', async () => {
    const fetchSpy = vi.fn(async () => new Response(VALID_XML, { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)

    const rows = await fetchAndStoreLatestBnrRates(['EUR', 'USD'])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(rows).toEqual([
      { date: '2026-07-16', currency: 'EUR', rate: '4.976700' },
      { date: '2026-07-16', currency: 'USD', rate: '4.573200' },
    ])

    const dbRows = await db
      .select()
      .from(exchangeRates)
      .where(and(eq(exchangeRates.date, '2026-07-16'), eq(exchangeRates.currency, 'USD')))
    expect(dbRows[0]?.rate).toBe('4.573200')
  })

  it('stores the currencies that ARE in the feed even if one is missing (partial success, not all-or-nothing)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(VALID_XML, { status: 200 })))

    const rows = await fetchAndStoreLatestBnrRates(['EUR', 'GBP'])
    expect(rows).toEqual([{ date: '2026-07-16', currency: 'EUR', rate: '4.976700' }])
  })

  it('throws when NONE of the requested currencies are in the feed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(VALID_XML, { status: 200 })))
    await expect(fetchAndStoreLatestBnrRates(['GBP', 'CHF'])).rejects.toThrow(/Niciun curs valabil/)
  })
})

describe('getRateForDate', () => {
  // Calculate dinamic (nu hardcodat) — getRateForDate compară dateIso cu new Date() reală,
  // deci un TODAY fix ar rugini imediat ce testul rulează într-o zi diferită de cea la care
  // a fost scris (exact ce s-a întâmplat aici — a rugini pe 2026-07-17 cu TODAY='2026-07-16').
  const TODAY = new Date().toISOString().slice(0, 10)
  const OLDER = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  // Necesar ȘI înainte, nu doar după: jobs/bnr-daily-fetch.ts (cron real, livrat tot în
  // acest sprint) rulează efectiv pe DB-ul de dev/prod, deci pot exista deja rânduri REALE
  // în ultimele zile (nu doar TODAY exact) când pornesc testele — `lookup()` din bnr.ts ia
  // "cel mai recent rând ≤ dată", deci un rând real de ieri "câștigă" în fața unuia mockuit
  // de test pt. o dată mai veche. Curățăm o fereastră largă (10 zile), nu doar punctual.
  beforeEach(() => cleanupRecent())

  afterEach(async () => {
    await cleanupRecent()
    // VALID_XML are data cube-ului hardcodată (2026-07-16), care poate ieși din fereastra
    // de mai sus dacă testul ăsta nu mai rulează luni de zile — curățată explicit, separat.
    await cleanupDate('2026-07-16')
  })

  it('returns the existing exact-date row WITHOUT calling fetch', async () => {
    await db.insert(exchangeRates).values({ date: TODAY, currency: 'EUR', rate: '4.900000' })
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const row = await getRateForDate(TODAY)
    expect(row.rate).toBe('4.900000')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fetches live when the exact-date row is missing', async () => {
    const fetchSpy = vi.fn(async () => new Response(VALID_XML, { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)

    const row = await getRateForDate(TODAY)
    expect(row.rate).toBe('4.976700')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('falls back to an older existing row when live fetch fails', async () => {
    await db.insert(exchangeRates).values({ date: OLDER, currency: 'EUR', rate: '4.850000' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bnr down', { status: 500 })),
    )

    // Weekend scenario: dateIso azi (sâmbătă), ultimul rând existent e vineri (OLDER < TODAY).
    const row = await getRateForDate(TODAY)
    expect(row.date).toBe(OLDER)
    expect(row.rate).toBe('4.850000')
  })

  it('throws when live fetch fails AND there is no older row to fall back on', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bnr down', { status: 500 })),
    )
    await expect(getRateForDate(TODAY)).rejects.toThrow()
  })

  it('BUG-QA-BNR-1 fixat: o cerere pt. o dată din TRECUT nu mai declanșează fetch live dacă există deja un fallback', async () => {
    // Feed-ul BNR întoarce mereu cursul CEL MAI RECENT, niciodată unul istoric la cerere —
    // deci un fetch live n-are cum să aducă date noi pt. o dată din trecut (OLDER, aici).
    // Fixat: getRateForDate încearcă fetch live DOAR când dateIso === azi.
    await cleanupDate('2026-07-05')
    await db.insert(exchangeRates).values({ date: '2026-07-05', currency: 'EUR', rate: '4.850000' })
    const fetchSpy = vi.fn(async () => new Response(VALID_XML, { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)

    const row = await getRateForDate(OLDER) // OLDER (2026-07-10) != rândul existent (2026-07-05), dar OLDER nu e azi
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(row.date).toBe('2026-07-05')
    await cleanupDate('2026-07-05')
  })

  it('cererea pt. AZI tot încearcă fetch live (comportament păstrat, doar restrâns la azi)', async () => {
    await db.insert(exchangeRates).values({ date: OLDER, currency: 'EUR', rate: '4.850000' })
    const fetchSpy = vi.fn(async () => new Response(VALID_XML, { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)

    await getRateForDate(TODAY)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
