/**
 * modules/assistant/quota.ts — plafonul lunar per om (PLAN.md C2, BE-5). pg real: singurul
 * lucru testat aici e agregarea din `assistant_usage` + pragurile 80% / 100%.
 * Emailul de alertă și push-ul sunt mock-uite (nu ies din aplicație în teste).
 */
import { and, eq, inArray, like } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import { alertRules, alerts, assistantUsage, dashboardConfig, roles, users } from '../../shared/db/schema/index.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { currentMonth, checkQuota, getMonthlyCap, quotaState, recordUsage } from './quota.js'

vi.mock('../../shared/lib/email.js', () => ({ sendAlertEmail: vi.fn(async () => {}) }))
vi.mock('../../shared/lib/push.js', () => ({ notifyPush: vi.fn(async () => {}) }))

const CAP_KEY = 'assistant.monthly_token_cap'
const [managerRole] = await db.select({ id: roles.id }).from(roles).where(eq(roles.name, 'Manager'))

const [colleague] = await db
  .insert(users)
  .values({ email: 'quota-test@vanadium.systems', passwordHash: 'x', displayName: 'Ana Popescu', roleId: managerRole!.id })
  .returning()
const [admin] = await db.select().from(users).where(eq(users.isPlatformAdmin, true)).limit(1)

const colleagueSession = {
  id: colleague!.id,
  email: colleague!.email,
  displayName: colleague!.displayName,
  role: { id: managerRole!.id, name: 'Manager', kind: 'manager' as const },
  isPlatformAdmin: false,
  features: [],
  mailboxes: null,
  status: 'active' as const,
  lastSeenAt: null,
  notificationPrefs: null,
  navLayout: null,
  updatesSeenAt: null,
  sessionVersion: 1,
} satisfies SessionUser

const adminSession = {
  ...colleagueSession,
  id: admin!.id,
  email: admin!.email,
  displayName: admin!.displayName,
  role: { ...colleagueSession.role, kind: 'admin' as const },
  isPlatformAdmin: true,
} satisfies SessionUser

async function setCap(value: number | null) {
  await db.delete(dashboardConfig).where(eq(dashboardConfig.key, CAP_KEY))
  if (value !== null) await db.insert(dashboardConfig).values({ key: CAP_KEY, value })
}

async function usageRows() {
  return db.select().from(assistantUsage).where(eq(assistantUsage.userId, colleague!.id))
}

async function quotaAlerts() {
  const rules = await db.select({ id: alertRules.id }).from(alertRules).where(like(alertRules.metricKey, 'assistant.quota.%'))
  if (rules.length === 0) return []
  return db.select().from(alerts).where(inArray(alerts.ruleId, rules.map((r) => r.id)))
}

beforeEach(async () => {
  await setCap(null)
  await db.delete(assistantUsage).where(eq(assistantUsage.userId, colleague!.id))
  const rules = await db.select({ id: alertRules.id }).from(alertRules).where(like(alertRules.metricKey, 'assistant.quota.%'))
  if (rules.length > 0) {
    await db.delete(alerts).where(inArray(alerts.ruleId, rules.map((r) => r.id)))
    await db.delete(alertRules).where(inArray(alertRules.id, rules.map((r) => r.id)))
  }
})

afterAll(async () => {
  await setCap(null)
  await db.delete(assistantUsage).where(eq(assistantUsage.userId, colleague!.id))
  await db.delete(users).where(and(eq(users.id, colleague!.id)))
})

describe('currentMonth', () => {
  it('bucket pe luna calendaristică din București, nu pe UTC', () => {
    // 31 decembrie 23:30 UTC = 1 ianuarie 00:30 în România.
    expect(currentMonth(new Date('2026-12-31T23:30:00Z'))).toBe('2027-01')
    expect(currentMonth(new Date('2026-09-30T21:30:00Z'))).toBe('2026-10')
  })
})

describe('getMonthlyCap', () => {
  it('fără setare → null (niciun plafon); cu 0 sau valoare non-numerică → tot null', async () => {
    expect(await getMonthlyCap()).toBeNull()
    await setCap(0)
    expect(await getMonthlyCap()).toBeNull()
    await setCap(Number.NaN)
    expect(await getMonthlyCap()).toBeNull()
  })

  it('cu setare → numărul de tokeni', async () => {
    await setCap(50_000)
    expect(await getMonthlyCap()).toBe(50_000)
  })
})

describe('checkQuota', () => {
  it('fără plafon setat → merge oricât de mult', async () => {
    await recordUsage(colleagueSession, 999_999, 0)
    expect(await checkQuota(colleagueSession)).toEqual({ ok: true })
    expect(await quotaAlerts()).toHaveLength(0)
  })

  it('sub plafon → ok; la plafon → ASSISTANT_QUOTA cu mesaj pentru om', async () => {
    await setCap(1000)
    await recordUsage(colleagueSession, 900, 0)
    expect((await checkQuota(colleagueSession)).ok).toBe(true)

    await recordUsage(colleagueSession, 200, 0)
    const check = await checkQuota(colleagueSession)
    expect(check.ok).toBe(false)
    if (check.ok) throw new Error('trebuia să fie refuzat')
    expect(check.code).toBe('ASSISTANT_QUOTA')
    expect(check.message).toContain('1.100 din 1.000')
    expect(check.message).toContain(currentMonth())
  })

  it('adminul nu e plafonat, oricâte tokeni ar fi consumat', async () => {
    await setCap(1000)
    await recordUsage(adminSession, 10_000_000, 0)
    expect((await checkQuota(adminSession)).ok).toBe(true)
  })
})

describe('recordUsage', () => {
  it('adună rândul lunii, input + output', async () => {
    await setCap(null)
    await recordUsage(colleagueSession, 100, 20)
    await recordUsage(colleagueSession, 5, 1)
    const rows = await usageRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.month).toBe(currentMonth())
    expect(rows[0]!.inputTokens).toBe(105)
    expect(rows[0]!.outputTokens).toBe(21)
    const state = await quotaState(colleagueSession)
    expect(state.used).toBe(126)
    expect(state.ratio).toBeNull()
  })

  it('la 80% din plafon ridică o singură alertă, la traversare', async () => {
    await setCap(1000)
    await recordUsage(colleagueSession, 700, 0)
    expect(await quotaAlerts()).toHaveLength(0)

    await recordUsage(colleagueSession, 100, 0) // 800 = pragul
    const raised = await quotaAlerts()
    expect(raised).toHaveLength(1)
    expect(raised[0]!.message).toContain('80%')
    expect(raised[0]!.message).toContain('Ana Popescu')

    await recordUsage(colleagueSession, 100, 0) // peste prag, nu se mai ridica nimic
    expect(await quotaAlerts()).toHaveLength(1)
  })

  it('turul fără consum nu scrie rând și nu ridică alertă', async () => {
    await setCap(1000)
    await recordUsage(colleagueSession, 0, 0)
    expect(await usageRows()).toHaveLength(0)
    expect(await quotaAlerts()).toHaveLength(0)
  })
})
