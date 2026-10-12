/**
 * Integration test — pg real (test/setup.ts). VAPID neconfigurat în test env → notifyPush
 * trebuie să facă no-op silențios (niciun throw), preferences round-trip prin dashboard_config.
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db } from '../db/client.js'
import { dashboardConfig, deviceTokens, users } from '../db/schema/index.js'
import { getPushPreferences, notifyPush, setPushPreferences, setFcmSenderForTests } from './push.js'

afterAll(async () => {
  await db.delete(dashboardConfig).where(eq(dashboardConfig.key, 'push_preferences'))
  await db.delete(deviceTokens).where(inArray(deviceTokens.token, ['qa-token-stefan', 'qa-token-ana']))
})

describe('push preferences', () => {
  it('întoarce default-urile (toate active) când nu există rând în dashboard_config', async () => {
    const prefs = await getPushPreferences()
    expect(prefs).toEqual({
      alerts: true,
      email: true,
      invoiceStatus: true,
      calendarReminder: true,
      paymentMatch: true,
      mesaje: true,
      suport: true,
    })
  })

  it('setPushPreferences face merge parțial, nu overwrite total', async () => {
    await setPushPreferences({ email: false })
    const prefs = await getPushPreferences()
    expect(prefs.email).toBe(false)
    expect(prefs.alerts).toBe(true) // neschimbat

    await setPushPreferences({ alerts: false })
    const prefs2 = await getPushPreferences()
    expect(prefs2.email).toBe(false) // rămas din update-ul anterior
    expect(prefs2.alerts).toBe(false)
  })
})

describe('notifyPush', () => {
  it('nu aruncă când VAPID e neconfigurat (no-op silențios, pattern RESEND_API_KEY)', async () => {
    await expect(notifyPush('alerts', { title: 'QA', body: 'test' })).resolves.toBeUndefined()
  })

  it('trimite doar dispozitivelor oamenilor din listă, nu tuturor abonaților', async () => {
    // Testul precedent a sters preferința `alerts` din dashboard_config (leagă aceleași rânduri).
    await setPushPreferences({ alerts: true })
    // Rândul poate fi rămas în DB dintr-o rulare eșuată (user + token-uri au cascade între ele).
    await db.delete(users).where(eq(users.email, 'push-test-ana@vanadium.systems'))
    const [stefan] = await db.select({ id: users.id }).from(users).where(eq(users.isPlatformAdmin, true)).limit(1)
    const [ana] = await db
      .insert(users)
      .values({ email: 'push-test-ana@vanadium.systems', passwordHash: 'x', displayName: 'Ana' })
      .returning()
    await db.insert(deviceTokens).values([
      { token: 'qa-token-stefan', ownerUserId: stefan!.id },
      { token: 'qa-token-ana', ownerUserId: ana!.id },
    ])

    let delivered: string[] = []
    setFcmSenderForTests(async (tokens) => {
      delivered = tokens
      return []
    })
    await notifyPush('alerts', { title: 'QA', body: 'test' }, [ana!.id])
    expect(delivered).toEqual(['qa-token-ana'])

    // Fără listă → toți abonații (alertele de sistem se comportă ca până acum).
    await notifyPush('alerts', { title: 'QA', body: 'test' })
    expect(delivered.sort()).toEqual(['qa-token-ana', 'qa-token-stefan'])

    setFcmSenderForTests(null)
    await db.delete(deviceTokens).where(inArray(deviceTokens.token, ['qa-token-stefan', 'qa-token-ana']))
    await db.delete(users).where(eq(users.id, ana!.id))
  })
})
