import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../shared/db/client.js'
import { notifications } from '../../shared/db/schema/index.js'
import { notify } from '../../shared/lib/notify.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { listNotifications, markRead } from './service.js'

const userIds: string[] = []
let ana: SessionUser
let bob: SessionUser

beforeAll(async () => {
  ana = await createTestUser('notif-ana', userIds)
  bob = await createTestUser('notif-bob', userIds)
})

afterAll(async () => {
  await db.delete(notifications).where(inArray(notifications.userId, userIds))
  await cleanupTestUsers(userIds)
})

describe('notifications', () => {
  it('skips the actor and duplicates, and lists only the person’s own', async () => {
    await notify([ana.id, bob.id, bob.id], { kind: 'test', title: 'one', exceptUserId: ana.id })
    expect((await listNotifications(ana)).rows).toHaveLength(0)
    const mine = await listNotifications(bob)
    expect(mine.rows).toHaveLength(1)
    expect(mine.unread).toBe(1)
  })

  it('pages by cursor, 30 at a time', async () => {
    await notify([ana.id], { kind: 'test', title: 'first' })
    for (let i = 0; i < 31; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2))
      await notify([ana.id], { kind: 'test', title: `n${i}` })
    }
    const page = await listNotifications(ana)
    expect(page.rows).toHaveLength(30)
    expect(page.nextCursor).toBeTruthy()
    const next = await listNotifications(ana, page.nextCursor!)
    expect(next.rows).toHaveLength(2)
    expect(next.nextCursor).toBeNull()
  })

  it('marks some, then all, and never touches another person’s', async () => {
    const page = await listNotifications(ana)
    const [first] = page.rows
    expect(await markRead(ana, { ids: [first!.id] })).toEqual({ marked: 1 })
    expect(await markRead(bob, { ids: [page.rows[1]!.id] })).toEqual({ marked: 0 })
    expect((await listNotifications(ana)).unread).toBe(31)
    await markRead(ana, { all: true })
    expect((await listNotifications(ana)).unread).toBe(0)
    expect((await listNotifications(bob)).unread).toBe(1)
  })
})
