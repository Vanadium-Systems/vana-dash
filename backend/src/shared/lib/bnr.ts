import { and, desc, eq, lte } from 'drizzle-orm'
import { db } from '../db/client.js'
import { exchangeRates } from '../db/schema/index.js'
import { tr } from './i18n.js'

// BNR (Banca Națională a României) — curs zilnic RON per valută, pt. facturarea
// clienților `billing_clients` cu preț în valută (Sprint C, Track B — EUR) și pt.
// moneda facturii (Sprint D, Track 2 — extins la USD). Portat din recyclers_app
// (shared/lib/exchange-rates.ts, deja verificat acolo) — feed public, fără auth,
// o valoare pe zi lucrătoare (nu weekend/sărbători), toate valutele într-un singur XML.
//
// URL mutat de BNR pe `curs.bnr.ro` (găsit 2026-08-18 — `www.bnr.ro/nbrfxrates.xml` a
// început să dea 302 către homepage în jurul lui 2026-08-05, deci fetch-ul livra HTML în
// loc de XML, parseBnrRate arunca la fiecare apel, iar getRateForDate nu mai prindea
// niciodată cache hit pt. "azi" — live fetch (lent, ~2-5s) pe FIECARE request care avea
// nevoie de MRR, nu doar o dată pe zi cum era gândit).

const BNR_FEED_URL = 'https://curs.bnr.ro/nbrfxrates.xml'
const FETCH_TIMEOUT_MS = 10_000
// Un singur request, fără retry, a produs alerte false la un blip tranzitoriu de rețea
// (timeout izolat, 2026-09-15 — feed-ul răspundea normal la reîncercare manuală). Extins la
// 5 încercări (2026-09-21, Stefan) — sursa e flaky-ish, nu jos constant: request-uri directe
// din același loc, la câteva secunde distanță, alternează eșec/succes. Se oprește la primul
// succes, nu așteaptă toate cele 5.
const MAX_ATTEMPTS = 5
const RETRY_DELAY_MS = 1_000

async function fetchOnce(): Promise<string> {
  const res = await fetch(BNR_FEED_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(tr('errors.bnr.http', { status: res.status }))
  return await res.text()
}

export interface ExchangeRateRow {
  date: string
  currency: string
  rate: string
}

async function fetchBnrFeed(): Promise<string> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchOnce()
    } catch (err) {
      lastErr = err
      if (attempt < MAX_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }
  throw new Error(tr('errors.bnr.fetchFailed', { MAX_ATTEMPTS, lastErr: String(lastErr) }))
}

/** Extrage data publicării + cursul unei valute din feed-ul XML zilnic al BNR. */
export function parseBnrRate(xml: string, currency: string): { date: string; rate: number } {
  const cubeMatch = /<Cube date="(\d{4}-\d{2}-\d{2})">([\s\S]*?)<\/Cube>/.exec(xml)
  if (!cubeMatch) throw new Error(tr('errors.bnr.noCube'))
  const [, date, cubeBody] = cubeMatch
  const rateMatch = [...cubeBody!.matchAll(/<Rate currency="([^"]+)"[^>]*>([\d.]+)<\/Rate>/g)].find(
    (match) => match[1] === currency,
  )
  if (!rateMatch) throw new Error(tr('errors.bnr.noRate', { currency }))
  const rate = Number.parseFloat(rateMatch[2]!)
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(tr('errors.bnr.rateNotNumber', { currency, value: rateMatch[2] }))
  }
  return { date: date!, rate }
}

/** Back-compat — echivalent cu `parseBnrRate(xml, 'EUR')`. */
export function parseBnrEurRate(xml: string): { date: string; rate: number } {
  return parseBnrRate(xml, 'EUR')
}

async function upsertRate(date: string, currency: string, rate: number): Promise<ExchangeRateRow> {
  const rateStr = rate.toFixed(6)
  await db
    .insert(exchangeRates)
    .values({ date, currency, rate: rateStr })
    .onConflictDoUpdate({
      target: [exchangeRates.date, exchangeRates.currency],
      set: { rate: rateStr, fetchedAt: new Date() },
    })
  return { date, currency, rate: rateStr }
}

/** Preia feed-ul BNR și face upsert pe cursul unei singure valute a zilei publicării. */
export async function fetchAndStoreLatestBnrRate(currency = 'EUR'): Promise<ExchangeRateRow> {
  const xml = await fetchBnrFeed()
  const { date, rate } = parseBnrRate(xml, currency)
  return upsertRate(date, currency, rate)
}

/**
 * Preia feed-ul BNR O SINGURĂ dată și face upsert pe MAI MULTE valute — folosit de
 * `jobs/bnr-daily-fetch.ts` (cron zilnic, EUR+USD necondiționat) ca istoricul din
 * graficul de curs să nu aibă găuri în zilele fără facturare. Dacă o valută lipsește
 * din feed, celelalte tot se salvează (izolare per-valută, nu totul-sau-nimic).
 */
export async function fetchAndStoreLatestBnrRates(currencies: string[] = ['EUR', 'USD']): Promise<ExchangeRateRow[]> {
  const xml = await fetchBnrFeed()
  const rows: ExchangeRateRow[] = []
  const errors: string[] = []
  for (const currency of currencies) {
    try {
      const { date, rate } = parseBnrRate(xml, currency)
      rows.push(await upsertRate(date, currency, rate))
    } catch (err) {
      errors.push(`${currency}: ${String(err)}`)
    }
  }
  if (rows.length === 0) throw new Error(tr('errors.bnr.noValidRate', { errors: errors.join('; ') }))
  return rows
}

/**
 * Cursul cel mai recent PUBLICAT la sau înainte de `dateIso` pt. o valută — BNR nu
 * publică în weekend/sărbători, deci o factură emisă sâmbătă folosește legitim
 * cursul de vineri.
 *
 * Fetch live încercat DOAR când `dateIso` e ziua de azi (BUG-QA-BNR-1, fixat) — feed-ul
 * BNR întoarce mereu cursul CEL MAI RECENT publicat, niciodată unul istoric la cerere,
 * deci un fetch live n-are cum să aducă date noi pt. o dată din trecut: dacă lipsește
 * un rând istoric exact, singura sursă posibilă e oricum fallback-ul deja din DB (sau
 * eroare, dacă nu există niciunul). Pt. azi, fetch-ul live rămâne util (acoperă: cron-ul
 * zilnic n-a rulat încă, deploy proaspăt) — un rând mai vechi existent e folosit ca
 * fallback dacă fetch-ul live eșuează (rețea/BNR jos).
 */
export async function getRateForDate(dateIso: string, currency = 'EUR'): Promise<ExchangeRateRow> {
  const lookup = async (): Promise<ExchangeRateRow | null> => {
    const [row] = await db
      .select()
      .from(exchangeRates)
      .where(and(eq(exchangeRates.currency, currency), lte(exchangeRates.date, dateIso)))
      .orderBy(desc(exchangeRates.date))
      .limit(1)
    return row ? { date: row.date, currency: row.currency, rate: row.rate } : null
  }

  const existing = await lookup()
  if (existing && existing.date === dateIso) return existing

  const todayIso = new Date().toISOString().slice(0, 10)
  if (dateIso === todayIso) {
    try {
      await fetchAndStoreLatestBnrRate(currency)
    } catch (err) {
      if (existing) return existing
      throw err
    }
    const afterFetch = await lookup()
    if (afterFetch) return afterFetch
  }

  if (existing) return existing
  throw new Error(tr('errors.bnr.noRateAtDate', { currency, dateIso }))
}
