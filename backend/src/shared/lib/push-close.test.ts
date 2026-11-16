/**
 * A "close" push goes only to a person who was shown that notification and only once, so Chrome's
 * small allowance of silent pushes is not spent on devices with nothing to close.
 */
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const sent: { endpoint: string; body: Record<string, unknown> }[] = []
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: async (sub: { endpoint: string }, body: string) => {
      sent.push({ endpoint: sub.endpoint, body: JSON.parse(body) })
    },
  },
}))

const { config } = await import('../config.js')
const { db } = await import('../db/client.js')
const { pushSubscriptions, users } = await import('../db/schema/index.js')
const { closePushNotification, notifyPush, setPushPreferences } = await import('./push.js')

const EMAIL = 'push-close-test@example.com'
let personId = ''

beforeAll(async () => {
  Object.assign(config.vapid, { publicKey: 'test-public', privateKey: 'test-private', subject: 'mailto:test@example.com' })
  await setPushPreferences({ mesaje: true })
  await db.delete(users).where(eq(users.email, EMAIL))
  const [person] = await db.insert(users).values({ email: EMAIL, passwordHash: 'x', displayName: 'Acme' }).returning()
  personId = person!.id
  await db.insert(pushSubscriptions).values({ ownerUserId: personId, endpoint: 'https://push.example.com/close-test', p256dhKey: 'k', authKey: 'a' })
})

afterAll(async () => {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.ownerUserId, personId))
  await db.delete(users).where(eq(users.id, personId))
})

describe('closePushNotification', () => {
  it('closes a tag the person was shown, once, and nothing they were never shown', async () => {
    await closePushNotification(personId, 'chat-never-shown')
    expect(sent).toHaveLength(0)

    await notifyPush('mesaje', { title: 'Acme', body: 'hi', tag: 'chat-1' }, [personId])
    expect(sent.map((s) => s.body.tag)).toEqual(['chat-1'])

    await closePushNotification(personId, 'chat-1')
    expect(sent.at(-1)?.body).toEqual({ type: 'close', tag: 'chat-1' })

    const before = sent.length
    await closePushNotification(personId, 'chat-1')
    expect(sent).toHaveLength(before)
  })
})
