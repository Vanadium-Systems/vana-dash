/**
 * modules/jeffbot: the snapshot ingest (fail-closed token, validation, idempotency) and the
 * read routes. Real Postgres + app.inject. `fixtures/snapshot.json` is the reference shape the
 * bot's export has to produce.
 */
import { readFileSync } from 'node:fs'
import argon2 from 'argon2'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { buildServer } from '../../app.js'
import { config } from '../../shared/config.js'
import { db } from '../../shared/db/client.js'
import { jeffbotEquityPoints, jeffbotReviews, jeffbotState, jeffbotTrades, users, roles } from '../../shared/db/schema/index.js'
import type { JeffbotSnapshot } from './schema.js'

// Rolul Admin (seedat de migrare) ca user de test să vadă tot, ca Stefan.
const [adminRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Admin'))
const adminRoleId = adminRole!.id

const fixture = JSON.parse(readFileSync(new URL('./fixtures/snapshot.json', import.meta.url), 'utf8')) as JeffbotSnapshot
const stocksFixture = JSON.parse(
  readFileSync(new URL('./fixtures/snapshot-stocks.json', import.meta.url), 'utf8'),
) as JeffbotSnapshot & { stocks: NonNullable<JeffbotSnapshot['stocks']> }
const TOKEN = config.jeffbotIngestToken
const INGEST_URL = '/api/v1/integrations/jeffbot/snapshot'

const app = await buildServer()
await app.ready()

const TEST_EMAIL = `qa-jeffbot-${Date.now()}@vanadium.systems`
const TEST_PASSWORD = 'qa-test-password-123'
const [testUser] = await db
  .insert(users)
  .values({ email: TEST_EMAIL, passwordHash: await argon2.hash(TEST_PASSWORD), displayName: 'QA Stefan', roleId: adminRoleId })
  .returning()
const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: TEST_EMAIL, password: TEST_PASSWORD } })
const sessionCookie = login.cookies.find((c) => c.name === 'vana_session')!.value

async function wipeJeffbot() {
  await db.delete(jeffbotEquityPoints)
  await db.delete(jeffbotTrades)
  await db.delete(jeffbotReviews)
  await db.delete(jeffbotState)
}

beforeEach(wipeJeffbot)
afterAll(async () => {
  await wipeJeffbot()
  await db.delete(users).where(eq(users.id, testUser!.id))
  await app.close()
})

function ingest(payload: unknown, token: string | null = TOKEN) {
  return app.inject({ method: 'POST', url: INGEST_URL, payload: payload as object, headers: token ? { 'x-ingest-token': token } : {} })
}

function get(url: string) {
  return app.inject({ method: 'GET', url, cookies: { vana_session: sessionCookie } })
}

async function counts() {
  const [row] = await db.execute<{ points: number; trades: number; stockPoints: number; stockTrades: number; reviews: number; states: number }>(sql`
    SELECT (SELECT count(*)::int FROM jeffbot_equity_points WHERE market = 'crypto') AS points,
           (SELECT count(*)::int FROM jeffbot_trades WHERE market = 'crypto') AS trades,
           (SELECT count(*)::int FROM jeffbot_equity_points WHERE market = 'stocks') AS "stockPoints",
           (SELECT count(*)::int FROM jeffbot_trades WHERE market = 'stocks') AS "stockTrades",
           (SELECT count(*)::int FROM jeffbot_reviews) AS reviews,
           (SELECT count(*)::int FROM jeffbot_state) AS states`)
  return row
}

describe('POST /api/v1/integrations/jeffbot/snapshot — auth', () => {
  it('401 fără token', async () => {
    expect((await ingest(fixture, null)).statusCode).toBe(401)
  })

  it('401, nu 400, pe body gol fără token — forma snapshot-ului nu iese spre apelanți anonimi', async () => {
    const res = await ingest({}, null)
    expect(res.statusCode).toBe(401)
    expect(res.body).not.toContain('equity')
  })

  it('401, nu 400, pe o rută cu sesiune și body invalid fără cookie', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/alert-rules', payload: {} })
    expect(res.statusCode).toBe(401)
  })

  it('401 cu token greșit', async () => {
    expect((await ingest(fixture, 'nu-e-tokenul')).statusCode).toBe(401)
  })

  it('401 la orice dacă JEFFBOT_INGEST_TOKEN lipsește din env', async () => {
    config.jeffbotIngestToken = ''
    try {
      expect((await ingest(fixture, TOKEN)).statusCode).toBe(401)
    } finally {
      config.jeffbotIngestToken = TOKEN
    }
    expect(await counts()).toMatchObject({ states: 0 })
  })
})

describe('POST /api/v1/integrations/jeffbot/snapshot — ingest', () => {
  it('400 pe payload invalid', async () => {
    const res = await ingest({ ...fixture, schemaVersion: 2 })
    expect(res.statusCode).toBe(400)
    const bad = await ingest({ ...fixture, trades: [{ ...fixture.trades[0], side: 'moon' }] })
    expect(bad.statusCode).toBe(400)
  })

  it('e idempotent: același snapshot de 2 ori ⇒ aceleași rânduri', async () => {
    expect((await ingest(fixture)).statusCode).toBe(200)
    const first = await counts()
    expect(first).toEqual({ points: 3, trades: 2, stockPoints: 0, stockTrades: 0, reviews: 1, states: 1 })

    expect((await ingest(fixture)).statusCode).toBe(200)
    expect(await counts()).toEqual(first)
  })

  it('actualizează echitatea pe același (key, ts) și rescrie raportul schimbat', async () => {
    await ingest(fixture)
    await ingest({
      ...fixture,
      equityPoints: [{ key: 'mix', ts: '2026-09-25T13:00:00Z', equity: 3010 }],
      reviews: [{ ...fixture.reviews[0]!, severity: 'warn', summary: 'Colectorul întârzie.' }],
    })
    const [point] = await db.select().from(jeffbotEquityPoints).where(and(eq(jeffbotEquityPoints.key, 'mix'), eq(jeffbotEquityPoints.ts, new Date('2026-09-25T13:00:00Z'))))
    expect(Number(point!.equity)).toBe(3010)
    const [review] = await db.select().from(jeffbotReviews)
    expect(review).toMatchObject({ severity: 'warn', summary: 'Colectorul întârzie.' })
  })
})

describe('GET /api/jeffbot/* — Contract B', () => {
  it('401 fără sesiune', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/jeffbot/overview' })
    expect(res.statusCode).toBe(401)
  })

  it('overview e null până vine primul snapshot', async () => {
    const res = await get('/api/jeffbot/overview')
    expect(res.json()).toEqual({ success: true, data: null })
  })

  it('overview: snapshot fără serii, tranzacții și rapoarte fără markdown', async () => {
    await ingest(fixture)
    const { data } = (await get('/api/jeffbot/overview')).json()
    expect(data.stale).toBe(false)
    expect(data.snapshot.strategies).toHaveLength(3)
    expect(data.snapshot).not.toHaveProperty('equityPoints')
    expect(data.snapshot).not.toHaveProperty('trades')
    expect(data.trades[0]).toMatchObject({ symbol: 'BTCUSDT', side: 'buy', price: 84700 })
    expect(data.reviews[0]).not.toHaveProperty('markdown')
  })

  it('overview: stale după 15 min', async () => {
    await ingest(fixture)
    await db.update(jeffbotState).set({ receivedAt: new Date(Date.now() - 16 * 60 * 1000) })
    const { data } = (await get('/api/jeffbot/overview')).json()
    expect(data.stale).toBe(true)
  })

  it('equity: numere, ordonate pe ts', async () => {
    await ingest(fixture)
    const { data } = (await get('/api/jeffbot/equity?days=all')).json()
    expect(data).toHaveLength(3)
    expect(typeof data[0].equity).toBe('number')
    expect(data.map((p: { ts: string }) => p.ts)).toEqual([...data.map((p: { ts: string }) => p.ts)].sort())
    expect((await get('/api/jeffbot/equity?days=5')).statusCode).toBe(400)
  })

  it('reviews/:id întoarce markdown-ul, 404 pe id necunoscut', async () => {
    await ingest(fixture)
    const { data } = (await get('/api/jeffbot/overview')).json()
    const review = (await get(`/api/jeffbot/reviews/${data.reviews[0].id}`)).json()
    expect(review.data.markdown).toContain('# Revizuire zilnică')
    expect((await get('/api/jeffbot/reviews/00000000-0000-0000-0000-000000000000')).statusCode).toBe(404)
  })
})

describe('bursă — Contract C (ingest) + Contract D (citire)', () => {
  it('snapshot cu `stocks` e idempotent pe ambele piețe', async () => {
    expect((await ingest(stocksFixture)).statusCode).toBe(200)
    const first = await counts()
    expect(first).toEqual({ points: 3, trades: 2, stockPoints: 10, stockTrades: 2, reviews: 1, states: 1 })
    expect((await ingest(stocksFixture)).statusCode).toBe(200)
    expect(await counts()).toEqual(first)
  })

  it('`hold` pe crypto și pe bursă, la același ts, nu se suprascriu', async () => {
    await ingest(stocksFixture)
    const rows = await db
      .select({ market: jeffbotEquityPoints.market, equity: jeffbotEquityPoints.equity })
      .from(jeffbotEquityPoints)
      .where(and(eq(jeffbotEquityPoints.key, 'hold'), eq(jeffbotEquityPoints.ts, new Date('2026-09-25T13:00:00Z'))))
    expect(Object.fromEntries(rows.map((r) => [r.market, Number(r.equity)]))).toEqual({ crypto: 1004.2, stocks: 3000 })
  })

  it('payload-ul păstrează `stocks` fără serii', async () => {
    await ingest(stocksFixture)
    const [state] = await db.select().from(jeffbotState)
    const stocks = (state!.payload as Record<string, Record<string, unknown>>).stocks!
    expect(stocks).toHaveProperty('session')
    expect(stocks).not.toHaveProperty('equityPoints')
    expect(stocks).not.toHaveProperty('trades')
  })

  it('400 pe bloc `stocks` invalid', async () => {
    const bad = { ...stocksFixture, stocks: { ...stocksFixture.stocks, broker: { ...stocksFixture.stocks.broker, mode: 'real' } } }
    expect((await ingest(bad)).statusCode).toBe(400)
    const tooMany = { ...stocksFixture, stocks: { ...stocksFixture.stocks, prices: Array(51).fill(stocksFixture.stocks.prices[0]) } }
    expect((await ingest(tooMany)).statusCode).toBe(400)
  })

  it('bloc `stocks` fără `news` (exportul vechi) ⇒ listă goală', async () => {
    expect((await ingest({ ...stocksFixture, stocks: { ...stocksFixture.stocks, news: undefined } })).statusCode).toBe(200)
    expect((await get('/api/jeffbot/overview?market=stocks')).json().data.snapshot.news).toEqual([])
  })

  it('overview crypto nu se schimbă când snapshot-ul are și `stocks`', async () => {
    await ingest({ ...stocksFixture, stocks: undefined })
    const before = (await get('/api/jeffbot/overview')).json()
    await ingest(stocksFixture)
    const after = (await get('/api/jeffbot/overview?market=crypto')).json()
    expect(after.data.snapshot).toEqual(before.data.snapshot)
    expect(after.data.snapshot).not.toHaveProperty('stocks')
    expect(after.data.trades.map((t: { symbol: string }) => t.symbol).sort()).toEqual(['BTCUSDT', 'SOLUSDT'])
  })

  it('overview?market=stocks: null fără bloc, plin cu bloc', async () => {
    await ingest(fixture)
    expect((await get('/api/jeffbot/overview?market=stocks')).json()).toEqual({ success: true, data: null })

    await ingest(stocksFixture)
    const { data } = (await get('/api/jeffbot/overview?market=stocks')).json()
    expect(data.snapshot).toMatchObject({ host: 'bot-host', currency: 'USD', broker: { name: 'alpaca', ok: true } })
    expect(data.snapshot.services.map((s: { name: string }) => s.name)).toContain('jeffbot-stocks')
    expect(data.snapshot.strategies.map((s: { key: string }) => s.key)).toEqual(['hold', 'trend200', 'trend200x15', 'gtaa', 'rotation'])
    expect(data.snapshot).not.toHaveProperty('equityPoints')
    expect(data.snapshot.news.map((n: { category: string }) => n.category)).toEqual(['macro_inflation', 'earnings'])
    expect(data.trades.map((t: { symbol: string }) => t.symbol).sort()).toEqual(['GLD', 'SPY'])
    expect(data.reviews).toHaveLength(1)
  })

  it('equity?market=stocks e filtrat pe piață; market necunoscut ⇒ 400', async () => {
    await ingest(stocksFixture)
    const stocks = (await get('/api/jeffbot/equity?days=all&market=stocks')).json().data
    const crypto = (await get('/api/jeffbot/equity?days=all')).json().data
    expect(stocks).toHaveLength(10)
    expect(crypto).toHaveLength(3)
    expect((await get('/api/jeffbot/equity?market=xyz')).statusCode).toBe(400)
    expect((await get('/api/jeffbot/overview?market=xyz')).statusCode).toBe(400)
  })

  it('401 fără sesiune pe market=stocks', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/jeffbot/overview?market=stocks' })
    expect(res.statusCode).toBe(401)
  })
})
