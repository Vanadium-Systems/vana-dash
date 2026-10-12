/**
 * Integration test — pg real (test/setup.ts). Verifică regulile de refresh token
 * (anaf_refresh_token_expiring, revolut_refresh_token_expiring), termenul D301/D390,
 * și dedup.
 *
 * `anaf_credentials` e citit cu `.limit(1)` fără filtru pe cif în
 * accounting-alerts.ts (model single-user — corect pt. producție, unde există
 * mereu exact un rând real). De când Stefan a configurat ANAF real în DB-ul de
 * dev (2026-07-10), tabela nu mai e goală — neutralizăm temporar orice rând
 * real (soft-delete) cât rulează testul și-l restaurăm exact în afterAll, ca
 * să nu pierdem/stricăm credențialele lui reale.
 */
import { and, eq, inArray, isNull, like } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../shared/db/client.js'
import {
  alertRules,
  alerts,
  anafCredentials,
  bankAccounts,
  bankTransactions,
  financialRecords,
} from '../shared/db/schema/index.js'
import { checkAccountingAlerts } from './accounting-alerts.js'

const DAY_MS = 24 * 60 * 60 * 1000
const ANAF_LAST_REFRESHED = new Date(Date.now() - 340 * DAY_MS) // < 30d de la expirarea estimată (365d)
const REVOLUT_LAST_REFRESHED = new Date(Date.now() - 85 * DAY_MS) // < 7d de la expirarea estimată (90d)

let anafCredId = ''
let revolutAccountId = ''
let neutralizedRealAnafIds: string[] = []

async function ruleRow(metricKey: string) {
  const [row] = await db.select().from(alertRules).where(eq(alertRules.metricKey, metricKey))
  return row
}

async function alertsFor(metricKey: string) {
  const rule = await ruleRow(metricKey)
  if (!rule) return []
  return db.select().from(alerts).where(eq(alerts.ruleId, rule.id))
}

beforeAll(async () => {
  const realRows = await db.select({ id: anafCredentials.id }).from(anafCredentials).where(isNull(anafCredentials.deletedAt))
  neutralizedRealAnafIds = realRows.map((r) => r.id)
  for (const id of neutralizedRealAnafIds) {
    await db.update(anafCredentials).set({ deletedAt: new Date() }).where(eq(anafCredentials.id, id))
  }

  const [anaf] = await db
    .insert(anafCredentials)
    .values({
      cif: 'QA-TEST-99999999',
      status: 'active',
      lastRefreshedAt: ANAF_LAST_REFRESHED,
      // expiresAt intenționat null — nu vrem să declanșăm alerta #2 (anaf_token_expiring),
      // doar #6 (anaf_refresh_token_expiring), izolat.
    })
    .returning({ id: anafCredentials.id })
  anafCredId = anaf!.id

  const [account] = await db
    .insert(bankAccounts)
    .values({
      provider: 'revolut',
      name: 'QA Alerts Test Revolut Account',
      currency: 'RON',
      authStatus: 'active',
      lastRefreshedAt: REVOLUT_LAST_REFRESHED,
    })
    .returning({ id: bankAccounts.id })
  revolutAccountId = account!.id
})

afterAll(async () => {
  await db.delete(anafCredentials).where(eq(anafCredentials.id, anafCredId))
  await db.delete(bankAccounts).where(eq(bankAccounts.id, revolutAccountId))
  for (const id of neutralizedRealAnafIds) {
    await db.update(anafCredentials).set({ deletedAt: null }).where(eq(anafCredentials.id, id))
  }
  // Alertele generate din datele de test — șterse ca să nu rămână „alerte" false
  // în dashboard-ul real al lui Stefan. anaf_refresh_token_expiring nu poartă
  // niciun identificator per-rând în mesaj (design corect — singleton în prod),
  // dar cât timp rândul real a fost neutralizat mai sus, orice alertă de pe
  // regula asta creată în fereastra testului e garantat a noastră.
  const anafRule = await ruleRow('accounting.anaf_refresh_token_expiring')
  if (anafRule) await db.delete(alerts).where(eq(alerts.ruleId, anafRule.id))
  const revolutRule = await ruleRow('accounting.revolut_refresh_token_expiring')
  if (revolutRule) {
    await db
      .delete(alerts)
      .where(and(eq(alerts.ruleId, revolutRule.id), like(alerts.message, '%QA Alerts Test Revolut Account%')))
  }
})

describe('checkAccountingAlerts — refresh token expiring rules', () => {
  it('creates an anaf_refresh_token_expiring alert when lastRefreshedAt is near the estimated lifetime', async () => {
    await checkAccountingAlerts()

    const rule = await ruleRow('accounting.anaf_refresh_token_expiring')
    expect(rule).toBeDefined()

    const rows = await alertsFor('accounting.anaf_refresh_token_expiring')
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0]!.severity).toBe('warning')
    expect(rows[0]!.message).toMatch(/Refresh token-ul ANAF expiră/)
  })

  it('creates a revolut_refresh_token_expiring alert for the near-expiry account', async () => {
    const rows = await alertsFor('accounting.revolut_refresh_token_expiring')
    const mine = rows.filter((r) => r.message.includes('QA Alerts Test Revolut Account'))
    expect(mine.length).toBeGreaterThanOrEqual(1)
    expect(mine[0]!.message).toMatch(/Refresh token-ul Revolut/)
  })

  it('does not create duplicate unacknowledged alerts when run twice', async () => {
    const beforeAnaf = (await alertsFor('accounting.anaf_refresh_token_expiring')).length
    const beforeRevolut = (await alertsFor('accounting.revolut_refresh_token_expiring')).filter((r) =>
      r.message.includes('QA Alerts Test Revolut Account'),
    ).length

    await checkAccountingAlerts()
    await checkAccountingAlerts()

    const afterAnaf = (await alertsFor('accounting.anaf_refresh_token_expiring')).length
    const afterRevolut = (await alertsFor('accounting.revolut_refresh_token_expiring')).filter((r) =>
      r.message.includes('QA Alerts Test Revolut Account'),
    ).length

    expect(afterAnaf).toBe(beforeAnaf)
    expect(afterRevolut).toBe(beforeRevolut)
  })
})

describe('checkAccountingAlerts — unmatched_transaction dedup (BUG-QA1, reparat)', () => {
  // Bug găsit de QA: dedup-ul din raiseAlert() cheie pe TEXTUL mesajului, iar
  // mesajul unmatched_transaction era compus din amount+currency+counterpartyName,
  // FĂRĂ id-ul tranzacției — două tranzacții distincte cu aceeași sumă+monedă+
  // contraparte generau exact același text și a doua era suprimată. Fix: mesajul
  // include acum un fragment din id-ul tranzacției (accounting-alerts.ts:199-206),
  // deci rămâne unic per tranzacție chiar la coliziune de sumă/contraparte.
  const counterpartyName = 'QA Test Unmatched Counterparty Collision'
  const txnIds: string[] = []

  beforeAll(async () => {
    const staleDate = new Date(Date.now() - 10 * DAY_MS) // > UNMATCHED_TXN_DAYS (7)
    const inserted = await db
      .insert(bankTransactions)
      .values([
        {
          bankAccountId: revolutAccountId,
          externalId: 'qa-collision-1',
          amount: '250.00',
          currency: 'RON',
          counterpartyName,
          direction: 'in',
          valueDate: staleDate,
        },
        {
          bankAccountId: revolutAccountId,
          externalId: 'qa-collision-2',
          amount: '250.00',
          currency: 'RON',
          counterpartyName,
          direction: 'in',
          valueDate: staleDate,
        },
      ])
      .returning({ id: bankTransactions.id })
    txnIds.push(...inserted.map((r) => r.id))
  })

  afterAll(async () => {
    for (const id of txnIds) {
      await db.delete(bankTransactions).where(eq(bankTransactions.id, id))
    }
    const rule = await ruleRow('accounting.unmatched_transaction')
    if (rule) {
      await db
        .delete(alerts)
        .where(and(eq(alerts.ruleId, rule.id), like(alerts.message, `%${counterpartyName}%`)))
    }
  })

  it('two distinct unmatched transactions with identical amount+currency+counterparty each get their own alert', async () => {
    await checkAccountingAlerts()

    const rows = await alertsFor('accounting.unmatched_transaction')
    const mine = rows.filter((r) => r.message.includes(counterpartyName))
    expect(mine.length).toBe(2)
  })
})

describe('checkAccountingAlerts — d301/d390 deadline reminder', () => {
  // Nu simulăm ceasul de sistem aici (diferit de alte teste din repo, ex.
  // archive-monthly-folders.test.ts): checkAccountingAlerts() rulează și celelalte
  // 7 reguli pe date reale din DB-ul de dev partajat cu Stefan (invoice_overdue,
  // unmatched_transaction etc. citesc TOATE rândurile, fără filtru), iar un `now` fals
  // aruncat în viitor le-ar face să evalueze greșit facturi/tranzacții reale ca
  // restante și să insereze alerte false + trimită email real. Testul rămâne corect
  // în orice zi a lunii: verifică ramura care se aplică efectiv azi (>= ziua 20 sau nu).
  const counterpartyName = 'QA Test Hetzner Deadline'
  const recordIds: string[] = []
  const now = new Date()
  const isPastReminderDay = now.getUTCDate() >= 20
  const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const prevPeriod = prevMonth.toISOString().slice(0, 7)

  beforeAll(async () => {
    const [row] = await db
      .insert(financialRecords)
      .values({
        type: 'expense',
        direction: 'in',
        amount: '100.00',
        currency: 'RON',
        issuedAt: new Date(Date.UTC(prevMonth.getUTCFullYear(), prevMonth.getUTCMonth(), 15)),
        source: 'manual',
        reverseChargeType: 'eu_services',
        counterpartyCountry: 'DE',
        counterpartyCif: '123456789',
        counterpartyName,
      })
      .returning()
    recordIds.push(row!.id)
  })

  afterAll(async () => {
    if (recordIds.length) await db.delete(financialRecords).where(inArray(financialRecords.id, recordIds))
    const d301Rule = await ruleRow('accounting.d301_deadline_approaching')
    if (d301Rule) await db.delete(alerts).where(and(eq(alerts.ruleId, d301Rule.id), like(alerts.message, `%${prevPeriod}%`)))
    const d390Rule = await ruleRow('accounting.d390_deadline_approaching')
    if (d390Rule) await db.delete(alerts).where(and(eq(alerts.ruleId, d390Rule.id), like(alerts.message, `%${prevPeriod}%`)))
  })

  it('raises D301/D390 alerts for the previous month only once past day 20 of the current month', async () => {
    await checkAccountingAlerts()

    const d301Rows = (await alertsFor('accounting.d301_deadline_approaching')).filter((r) =>
      r.message.includes(prevPeriod),
    )
    const d390Rows = (await alertsFor('accounting.d390_deadline_approaching')).filter((r) =>
      r.message.includes(prevPeriod),
    )

    if (isPastReminderDay) {
      expect(d301Rows.length).toBeGreaterThanOrEqual(1)
      expect(d390Rows.length).toBeGreaterThanOrEqual(1)
    } else {
      expect(d301Rows.length).toBe(0)
      expect(d390Rows.length).toBe(0)
    }
  })

  it('does not duplicate the alert on a second run', async () => {
    const before = (await alertsFor('accounting.d301_deadline_approaching')).filter((r) =>
      r.message.includes(prevPeriod),
    ).length
    await checkAccountingAlerts()
    const after = (await alertsFor('accounting.d301_deadline_approaching')).filter((r) =>
      r.message.includes(prevPeriod),
    ).length
    expect(after).toBe(before)
  })
})
