import { and, asc, desc, eq, gte, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { jeffbotEquityPoints, jeffbotReviews, jeffbotState, jeffbotTrades } from '../../shared/db/schema/index.js'
import type { JeffbotSnapshot, JeffbotStatePayload, Market } from './schema.js'

const STATE_KEY = 'current'
export const STALE_AFTER_MS = 15 * 60 * 1000

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function insertSeries(
  tx: Tx,
  market: Market,
  equityPoints: JeffbotSnapshot['equityPoints'],
  trades: JeffbotSnapshot['trades'],
  now: Date,
) {
  if (equityPoints.length) {
    await tx
      .insert(jeffbotEquityPoints)
      .values(equityPoints.map((p) => ({ market, key: p.key, ts: new Date(p.ts), equity: String(p.equity) })))
      .onConflictDoUpdate({
        target: [jeffbotEquityPoints.market, jeffbotEquityPoints.key, jeffbotEquityPoints.ts],
        set: { equity: sql`EXCLUDED.equity`, updatedAt: now },
      })
  }

  if (trades.length) {
    await tx
      .insert(jeffbotTrades)
      .values(
        trades.map((t) => ({
          market,
          sourceId: t.sourceId,
          ts: new Date(t.ts),
          strategy: t.strategy,
          subAccount: t.subAccount ?? null,
          symbol: t.symbol,
          side: t.side,
          qty: String(t.qty),
          price: String(t.price),
          feeUsdt: String(t.feeUsdt),
          reason: t.reason ?? null,
        })),
      )
      .onConflictDoNothing({ target: jeffbotTrades.sourceId })
  }
}

export async function ingestSnapshot(snapshot: JeffbotSnapshot): Promise<void> {
  const { equityPoints, trades, reviews, stocks, ...rest } = snapshot
  const payload: JeffbotStatePayload = rest
  if (stocks) {
    const { currency, session, broker, prices, strategies, news } = stocks
    payload.stocks = { currency, session, broker, prices, strategies, news }
  }
  const now = new Date()

  await db.transaction(async (tx) => {
    await tx
      .insert(jeffbotState)
      .values({ key: STATE_KEY, payload, generatedAt: new Date(snapshot.generatedAt), receivedAt: now })
      .onConflictDoUpdate({
        target: jeffbotState.key,
        set: { payload, generatedAt: new Date(snapshot.generatedAt), receivedAt: now, updatedAt: now },
      })

    await insertSeries(tx, 'crypto', equityPoints, trades, now)
    if (stocks) await insertSeries(tx, 'stocks', stocks.equityPoints, stocks.trades, now)

    // Raportul se rescrie doar dacă s-a schimbat conținutul — `received_at` rămâne astfel
    // momentul în care a apărut versiunea curentă, pe care se bazează alerta `review.critical`.
    for (const r of reviews) {
      await tx
        .insert(jeffbotReviews)
        .values({ date: r.date, kind: r.kind, severity: r.severity, summary: r.summary, markdown: r.markdown, receivedAt: now })
        .onConflictDoUpdate({
          target: [jeffbotReviews.date, jeffbotReviews.kind],
          set: { severity: r.severity, summary: r.summary, markdown: r.markdown, receivedAt: now, updatedAt: now },
          setWhere: sql`${jeffbotReviews.markdown} IS DISTINCT FROM EXCLUDED.markdown
            OR ${jeffbotReviews.severity} IS DISTINCT FROM EXCLUDED.severity`,
        })
    }
  })
}

export async function getState() {
  const [row] = await db
    .select({ payload: jeffbotState.payload, generatedAt: jeffbotState.generatedAt, receivedAt: jeffbotState.receivedAt })
    .from(jeffbotState)
    .where(eq(jeffbotState.key, STATE_KEY))
  return row ? { ...row, payload: row.payload as JeffbotStatePayload } : null
}

const reviewMetaColumns = {
  id: jeffbotReviews.id,
  date: jeffbotReviews.date,
  kind: jeffbotReviews.kind,
  severity: jeffbotReviews.severity,
  summary: jeffbotReviews.summary,
  receivedAt: jeffbotReviews.receivedAt,
}

export async function getLatestReview() {
  const [row] = await db
    .select(reviewMetaColumns)
    .from(jeffbotReviews)
    .orderBy(desc(jeffbotReviews.date), desc(jeffbotReviews.receivedAt))
    .limit(1)
  return row ?? null
}

export async function getOverview(market: Market = 'crypto', now = new Date()) {
  const state = await getState()
  if (!state) return null
  const { stocks, ...cryptoPayload } = state.payload
  if (market === 'stocks' && !stocks) return null

  const [trades, reviews] = await Promise.all([
    db
      .select({
        id: jeffbotTrades.id,
        ts: jeffbotTrades.ts,
        strategy: jeffbotTrades.strategy,
        subAccount: jeffbotTrades.subAccount,
        symbol: jeffbotTrades.symbol,
        side: jeffbotTrades.side,
        qty: sql<number>`${jeffbotTrades.qty}::float8`,
        price: sql<number>`${jeffbotTrades.price}::float8`,
        feeUsdt: sql<number>`${jeffbotTrades.feeUsdt}::float8`,
        reason: jeffbotTrades.reason,
      })
      .from(jeffbotTrades)
      .where(eq(jeffbotTrades.market, market))
      .orderBy(desc(jeffbotTrades.ts))
      .limit(50),
    db.select(reviewMetaColumns).from(jeffbotReviews).orderBy(desc(jeffbotReviews.date), asc(jeffbotReviews.kind)).limit(10),
  ])

  const snapshot =
    market === 'stocks'
      ? { generatedAt: cryptoPayload.generatedAt, host: cryptoPayload.host, services: cryptoPayload.services, ...stocks }
      : cryptoPayload

  return {
    receivedAt: state.receivedAt,
    stale: now.getTime() - state.receivedAt.getTime() > STALE_AFTER_MS,
    snapshot,
    trades,
    reviews,
  }
}

export async function getEquity(days: '7' | '30' | '90' | 'all', market: Market = 'crypto') {
  const where = and(
    eq(jeffbotEquityPoints.market, market),
    days === 'all' ? undefined : gte(jeffbotEquityPoints.ts, sql`now() - make_interval(days => ${Number(days)})`),
  )
  return db
    .select({ key: jeffbotEquityPoints.key, ts: jeffbotEquityPoints.ts, equity: sql<number>`${jeffbotEquityPoints.equity}::float8` })
    .from(jeffbotEquityPoints)
    .where(where)
    .orderBy(asc(jeffbotEquityPoints.ts), asc(jeffbotEquityPoints.key))
}

export async function getReview(id: string) {
  const [row] = await db
    .select({ ...reviewMetaColumns, markdown: jeffbotReviews.markdown })
    .from(jeffbotReviews)
    .where(eq(jeffbotReviews.id, id))
  return row ?? null
}
