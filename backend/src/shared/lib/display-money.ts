import { and, desc, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { exchangeRates } from '../db/schema/index.js'
import type { DisplayCurrency } from './locale.js'
import { actorStore, currentDisplayCurrency } from './request-context.js'

// The currency totals are shown in. A display preference only: the books stay in RON, every
// document keeps its own currency, and declarations are never converted.

/** Sent next to the figures of a response, so the screen says what it is showing. */
export interface MoneyMeta {
  currency: DisplayCurrency
  /** False when the figures are in RON, the currency they are kept in. */
  converted: boolean
  rateSource: 'BNR'
  /** The person asked for another currency, but there is no rate for it: the figures are in RON. */
  fallback?: 'no_rate'
}

export interface DisplayMoney extends MoneyMeta {
  /** RON for one unit of `currency` at the latest rate; 1 for RON. For values without a date (MRR). */
  rate: number
}

const RON: DisplayMoney = { currency: 'RON', converted: false, rateSource: 'BNR', rate: 1 }

async function resolve(wanted: DisplayCurrency): Promise<DisplayMoney> {
  if (wanted === 'RON') return RON
  const [latest] = await db
    .select({ rate: exchangeRates.rate })
    .from(exchangeRates)
    .where(and(eq(exchangeRates.currency, wanted), isNull(exchangeRates.deletedAt)))
    .orderBy(desc(exchangeRates.date))
    .limit(1)
  // No rate at all is not a rate of 1: a total in lei shown as euros would be five times too big.
  if (!latest) return { ...RON, fallback: 'no_rate' }
  return { currency: wanted, converted: true, rateSource: 'BNR', rate: Number(latest.rate) }
}

const perRequest = new WeakMap<object, Promise<DisplayMoney>>()

/** The display currency of the current request, checked once per request against the rates. */
export function displayMoney(): Promise<DisplayMoney> {
  const store = actorStore()
  if (!store) return resolve(currentDisplayCurrency())
  let pending = perRequest.get(store)
  if (!pending) {
    pending = resolve(currentDisplayCurrency())
    perRequest.set(store, pending)
  }
  return pending
}

export async function moneyMeta(): Promise<MoneyMeta> {
  const { currency, converted, rateSource, fallback } = await displayMoney()
  return fallback ? { currency, converted, rateSource, fallback } : { currency, converted, rateSource }
}

/** A current amount kept in RON (MRR, a monthly cost), in the display currency at the latest rate. */
export function fromRon(amountRon: number, money: DisplayMoney): number {
  return Math.round((amountRon / money.rate) * 100) / 100
}
