/**
 * Calls against the real DB, with Daily stubbed: the guest view says nothing about who the call
 * is for, a closed call cannot be joined, and the close job keeps the call's duration.
 */
import { inArray } from 'drizzle-orm'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import { calls } from '../../shared/db/schema/index.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { runCallsClose } from '../../jobs/calls-close.js'
import { CallError, createCall, endCall, getPublicCall, joinCall, listCalls } from './service.js'

const me = { id: '00000000-0000-4000-8000-0000000000aa', displayName: 'Acme Tester', email: 'tester@example.com' } as SessionUser
const callIds: string[] = []

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function stubDaily(meetings: Array<{ duration: number; max_participants: number }> = []) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/rooms') && init?.method === 'POST') {
      const { name } = JSON.parse(String(init.body)) as { name: string }
      return jsonResponse({ name, url: `https://acme.daily.co/${name}` })
    }
    if (url.includes('/meeting-tokens')) return jsonResponse({ token: 'owner-token' })
    if (url.includes('/meetings?')) return jsonResponse({ data: meetings })
    if (init?.method === 'DELETE') return jsonResponse({ deleted: true })
    return jsonResponse({}, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(async () => {
  if (callIds.length) await db.delete(calls).where(inArray(calls.id, callIds))
})

describe('calls', () => {
  it('creates a call whose row shows our link, never the Daily room', async () => {
    stubDaily()
    const call = await createCall({ title: 'Acme intro', expiresInHours: 2 })
    callIds.push(call.id)

    expect(call.status).toBe('open')
    expect(call.publicUrl).toMatch(/\/apel\/[A-Za-z0-9_-]{16}$/)
    expect(JSON.stringify(call)).not.toContain('daily.co')
    expect((await listCalls({ status: 'open', limit: 200 })).some((row) => row.id === call.id)).toBe(true)
  })

  it('the guest view of an open call has the room and nothing about who it is for', async () => {
    stubDaily()
    const call = await createCall({ title: 'Acme pricing', expiresInHours: 1 })
    callIds.push(call.id)
    const publicId = call.publicUrl.split('/').pop()!

    const view = await getPublicCall(publicId)
    expect(view?.status).toBe('open')
    expect(view?.roomUrl).toMatch(/^https:\/\/acme\.daily\.co\//)
    expect(JSON.stringify(view)).not.toContain('Acme pricing')
    expect(await getPublicCall('AAAAAAAAAAAAAAAA')).toBeNull()
  })

  it('an ended call cannot be joined and its guest view has no room', async () => {
    stubDaily()
    const call = await createCall({ title: 'Acme follow-up', expiresInHours: 1 })
    callIds.push(call.id)

    expect((await joinCall(call.id, me)).token).toBe('owner-token')
    expect((await endCall(call.id)).status).toBe('ended')
    await expect(joinCall(call.id, me)).rejects.toMatchObject({ code: 'closed', status: 410 })
    expect((await getPublicCall(call.publicUrl.split('/').pop()!))?.roomUrl).toBeNull()
  })

  it('an unknown call is not found', async () => {
    await expect(joinCall('00000000-0000-4000-8000-000000000000', me)).rejects.toBeInstanceOf(CallError)
  })

  it('the close job ends expired rooms and keeps how long they lasted', async () => {
    stubDaily([
      { duration: 600, max_participants: 2 },
      { duration: 300, max_participants: 3 },
    ])
    const call = await createCall({ title: 'Acme expired', expiresInHours: 1 })
    callIds.push(call.id)

    expect(await runCallsClose(new Date(Date.now() + 2 * 3_600_000))).toBeGreaterThanOrEqual(1)
    const [row] = await db.select().from(calls).where(inArray(calls.id, [call.id]))
    expect(row).toMatchObject({ status: 'ended', durationSeconds: 900, participantCount: 3 })
    expect(row?.roomDeletedAt).not.toBeNull()
  })
})
