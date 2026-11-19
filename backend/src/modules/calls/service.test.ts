/**
 * Calls against the real DB, with LiveKit HTTP stubbed: the guest view says nothing about
 * who the call is for, a closed call cannot be joined, tokens enforce membership/features,
 * livekit_settings encrypts credentials at rest, the close job cleans expired rooms, and rows left
 * by the removed Daily provider read as ended and never reach a remote API.
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import { calls, conversations, livekitSettings } from '../../shared/db/schema/index.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { getLiveKitSettingsView, saveLiveKitSettings } from '../../shared/lib/livekit.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'
import { runCallsClose, runEmptyCallsClose } from '../../jobs/calls-close.js'
import { closeCallRoom } from '../../shared/lib/call-rooms.js'
import { declineConversationCall, endConversationCall, listMessages, openDm, previewRef, startConversationCall } from '../chat/service.js'
import './refs.js'
import { CallError, createCall, endCall, getPublicCall, issueCallToken, issuePublicCallToken, joinCall, listCalls, extendCall, setScreenShare } from './service.js'

let me: SessionUser
let colleague: SessionUser
let outsider: SessionUser
let restricted: SessionUser
const cleanupUsers: string[] = []
const callIds: string[] = []
const conversationIds: string[] = []
let previousLiveKitRow: (typeof livekitSettings.$inferSelect) | null = null

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function stubLiveKit(rooms: Array<{ name: string; numParticipants?: number }> = []) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/twirp/livekit.RoomService/CreateRoom')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { name?: string }
      return jsonResponse({ sid: 'RM_acme', name: body.name ?? 'room' })
    }
    if (url.endsWith('/twirp/livekit.RoomService/DeleteRoom')) {
      return jsonResponse({})
    }
    if (url.endsWith('/twirp/livekit.RoomService/ListRooms')) {
      return jsonResponse({ rooms })
    }
    if (url.endsWith('/twirp/livekit.RoomService/UpdateRoomMetadata')) return jsonResponse({ name: 'room' })
    if (url.endsWith('/twirp/livekit.RoomService/ListParticipants')) return jsonResponse({ participants: [] })
    return jsonResponse({}, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeAll(async () => {
  me = await createTestUser('calls-host', cleanupUsers, { features: ['clienti.toti', 'apeluri.view', 'apeluri.manage', 'mesaje.view'] })
  colleague = await createTestUser('calls-peer', cleanupUsers, { features: ['mesaje.view'] })
  outsider = await createTestUser('calls-out', cleanupUsers, { features: ['mesaje.view'] })
  restricted = await createTestUser('calls-noright', cleanupUsers, { features: [] })
  const [existing] = await db.select().from(livekitSettings)
  previousLiveKitRow = existing ?? null
  if (existing) await db.delete(livekitSettings).where(eq(livekitSettings.id, existing.id))
  await saveLiveKitSettings({
    url: 'https://acme.livekit.cloud/',
    apiKey: 'APIacmeTestKey1234',
    apiSecret: 'acme-test-secret-0123456789abcdef012345',
    enabled: true,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(async () => {
  if (callIds.length) await db.delete(calls).where(inArray(calls.id, callIds))
  if (conversationIds.length) await db.delete(conversations).where(inArray(conversations.id, conversationIds))
  await db.delete(livekitSettings)
  if (previousLiveKitRow) {
    await db.insert(livekitSettings).values(previousLiveKitRow)
  }
  await cleanupTestUsers(cleanupUsers)
})

describe('calls', () => {
  it('creates a call whose row shows our link, never the SFU room', async () => {
    stubLiveKit()
    const call = await createCall(me, { title: 'Acme intro', expiresInHours: 2 })
    callIds.push(call.id)

    expect(call.status).toBe('open')
    expect(call.publicUrl).toMatch(/\/apel\/[A-Za-z0-9_-]{16}$/)
    expect(JSON.stringify(call)).not.toContain('livekit.cloud')
    expect((await listCalls(me, { status: 'open', limit: 200 })).some((row) => row.id === call.id)).toBe(true)
  })

  it('the guest view of an open call has the window and nothing about who it is for', async () => {
    stubLiveKit()
    const call = await createCall(me, { title: 'Acme pricing', expiresInHours: 1 })
    callIds.push(call.id)
    const publicId = call.publicUrl.split('/').pop()!

    const view = await getPublicCall(publicId)
    expect(view).toMatchObject({ status: 'open', provider: 'livekit' })
    expect(view).not.toHaveProperty('roomUrl')
    expect(JSON.stringify(view)).not.toContain('Acme pricing')
    expect(await getPublicCall('AAAAAAAAAAAAAAAA')).toBeNull()
  })

  it('an ended call cannot be joined and its guest view reads as ended', async () => {
    stubLiveKit()
    const call = await createCall(me, { title: 'Acme follow-up', expiresInHours: 1 })
    callIds.push(call.id)

    expect((await joinCall(call.id, me)).token.split('.')).toHaveLength(3)
    expect((await endCall(me, call.id)).status).toBe('ended')
    await expect(joinCall(call.id, me)).rejects.toMatchObject({ code: 'closed', status: 410 })
    expect((await getPublicCall(call.publicUrl.split('/').pop()!))?.status).toBe('ended')
  })

  it('only the host shares the screen until the host lets someone else', async () => {
    const manager = await createTestUser('calls-manager', cleanupUsers, { features: ['apeluri.view', 'apeluri.manage'] })
    stubLiveKit()
    const call = await createCall(me, { title: 'Acme demo', expiresInHours: 1 })
    callIds.push(call.id)
    const sourcesOf = (token: string) =>
      (JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as { video: { canPublishSources: string[]; roomAdmin?: boolean } }).video

    expect(sourcesOf((await issueCallToken(call.id, me)).token)).toMatchObject({ roomAdmin: true })
    expect(sourcesOf((await issueCallToken(call.id, me)).token).canPublishSources).toContain('screen_share')
    const before = sourcesOf((await issueCallToken(call.id, manager)).token)
    expect(before.canPublishSources).not.toContain('screen_share')
    expect(before.roomAdmin).toBeFalsy()
    await expect(setScreenShare(manager, call.id, { everyone: true })).rejects.toMatchObject({ code: 'forbidden', status: 403 })

    const fetchMock = stubLiveKit()
    expect(await setScreenShare(me, call.id, { identity: manager.id, allowed: true })).toEqual({ everyone: false, allowed: [manager.id] })
    const saved = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/UpdateRoomMetadata'))
    expect(String(saved?.[1]?.body)).toContain(manager.id)

    // A rejoin reads the policy back from the room.
    stubLiveKit([{ name: 'room', metadata: JSON.stringify({ screenShare: { everyone: false, allowed: [manager.id] } }) } as never])
    expect(sourcesOf((await issueCallToken(call.id, manager)).token).canPublishSources).toContain('screen_share')
  })

  it('only the host extends a call, and never past 8 hours from now', async () => {
    const manager = await createTestUser('calls-extender', cleanupUsers, { features: ['apeluri.view', 'apeluri.manage'] })
    stubLiveKit()
    const call = await createCall(me, { title: 'Acme long', expiresInHours: 1 })
    callIds.push(call.id)
    await expect(extendCall(manager, call.id, 1)).rejects.toMatchObject({ code: 'forbidden', status: 403 })

    const { expiresAt } = await extendCall(me, call.id, 1)
    expect(Date.parse(expiresAt) - Date.parse(call.expiresAt)).toBe(3_600_000)
    expect((await issueCallToken(call.id, manager)).expiresAt).toBe(expiresAt)
    for (let i = 0; i < 4; i++) await extendCall(me, call.id, 4)
    const [row] = await db.select().from(calls).where(eq(calls.id, call.id))
    expect(row!.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 8 * 3_600_000)
  })

  it('an unknown call is not found', async () => {
    await expect(joinCall('00000000-0000-4000-8000-000000000000', me)).rejects.toBeInstanceOf(CallError)
  })

  it('the close job ends expired rooms and keeps how many people were in them', async () => {
    stubLiveKit([{ name: 'any', numParticipants: 3 }])
    const call = await createCall(me, { title: 'Acme expired', expiresInHours: 1 })
    callIds.push(call.id)

    expect(await runCallsClose(new Date(Date.now() + 2 * 3_600_000))).toBeGreaterThanOrEqual(1)
    const [row] = await db.select().from(calls).where(inArray(calls.id, [call.id]))
    expect(row).toMatchObject({ status: 'ended', participantCount: 3 })
    expect(row?.roomDeletedAt).not.toBeNull()
  })
})

// Rows from the removed Daily provider: no room exists anywhere, so nothing may reach a remote API.
describe('legacy daily rows', () => {
  const stamp = Date.now().toString(36)
  let seq = 0

  async function insertDailyCall(expiresAt: Date) {
    seq += 1
    const [row] = await db
      .insert(calls)
      .values({
        title: `Acme legacy ${seq}`,
        roomName: `legacy-room-${stamp}-${seq}`,
        roomUrl: `https://demo.invalid/legacy-${stamp}-${seq}`,
        publicId: `legacy${stamp}${seq}`,
        provider: 'daily',
        createdByUserId: me.id,
        expiresAt,
      })
      .returning()
    callIds.push(row!.id)
    return row!
  }

  it('joining answers 410, signed in or as a guest', async () => {
    const fetchMock = stubLiveKit()
    const row = await insertDailyCall(new Date(Date.now() + 3_600_000))

    await expect(issueCallToken(row.id, me)).rejects.toMatchObject({ code: 'closed', status: 410 })
    await expect(joinCall(row.id, me)).rejects.toMatchObject({ code: 'closed', status: 410 })
    await expect(issuePublicCallToken(row.publicId, 'Guest Acme')).rejects.toMatchObject({ code: 'closed', status: 410 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the guest page reads as ended, without a room URL', async () => {
    const row = await insertDailyCall(new Date(Date.now() + 3_600_000))

    const view = await getPublicCall(row.publicId)
    expect(view).toMatchObject({ status: 'ended', provider: 'daily' })
    expect(view).not.toHaveProperty('roomUrl')
    expect(JSON.stringify(view)).not.toContain('demo.invalid')
  })

  it('endCall and closeCallRoom close the row without any request', async () => {
    const fetchMock = stubLiveKit()
    const first = await insertDailyCall(new Date(Date.now() + 3_600_000))
    const second = await insertDailyCall(new Date(Date.now() + 3_600_000))

    expect((await endCall(me, first.id)).status).toBe('ended')
    const cancelled = await closeCallRoom(second, 'cancelled')
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.roomDeletedAt).not.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the close job ends an expired row without a request and without LiveKit configured', async () => {
    const fetchMock = stubLiveKit()
    const expired = await insertDailyCall(new Date(Date.now() - 60_000))
    const open = await insertDailyCall(new Date(Date.now() + 3_600_000))
    const [saved] = await db.select().from(livekitSettings)
    await db.delete(livekitSettings)
    try {
      expect(await runCallsClose()).toBeGreaterThanOrEqual(1)
    } finally {
      if (saved) await db.insert(livekitSettings).values(saved)
    }

    const rows = await db.select().from(calls).where(inArray(calls.id, [expired.id, open.id]))
    const byId = new Map(rows.map((row) => [row.id, row]))
    expect(byId.get(expired.id)).toMatchObject({ status: 'ended' })
    expect(byId.get(expired.id)?.roomDeletedAt).not.toBeNull()
    expect(byId.get(open.id)?.status).toBe('open')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('livekit calls & chat integration', () => {
  it('encrypts livekit_settings at rest and masks key preview in settings view', async () => {
    const [row] = await db.select().from(livekitSettings)
    expect(row?.apiKeyEnc).toMatch(/^v1:/)
    expect(row?.apiSecretEnc).toMatch(/^v1:/)
    const view = await getLiveKitSettingsView()
    expect(view.configured).toBe(true)
    expect(view.url).toBe('https://acme.livekit.cloud/')
    expect(view.apiKeyPreview).toMatch(/^••••/)
    expect(JSON.stringify(view)).not.toContain('APIacmeTestKey1234')
    expect(JSON.stringify(view)).not.toContain('acme-test-secret')
  })

  it('creates LiveKit call, mints authenticated & guest JWT tokens, and closes cleanly', async () => {
    const lkFetch = stubLiveKit([{ name: 'any', numParticipants: 2 }])
    const call = await createCall(me, { title: 'Acme E2EE sync', kind: 'audio', expiresInHours: 1 })
    callIds.push(call.id)

    expect(call.provider).toBe('livekit')
    expect(call.kind).toBe('audio')

    const hostToken = await issueCallToken(call.id, me)
    expect(hostToken.provider).toBe('livekit')
    if (hostToken.provider === 'livekit') {
      expect(hostToken.livekitUrl).toBe('wss://acme.livekit.cloud')
      expect(hostToken.token.split('.')).toHaveLength(3)
      expect(hostToken.kind).toBe('audio')
    }

    const publicId = call.publicUrl.split('/').pop()!
    const publicInfo = await getPublicCall(publicId)
    expect(publicInfo).toMatchObject({ status: 'open', kind: 'audio', provider: 'livekit' })
    expect(JSON.stringify(publicInfo)).not.toContain('Acme E2EE sync')

    const guestToken = await issuePublicCallToken(publicId, 'Guest Acme')
    expect(guestToken.provider).toBe('livekit')
    if (guestToken.provider === 'livekit') {
      expect(guestToken.token.split('.')).toHaveLength(3)
      expect(guestToken.livekitUrl).toBe('wss://acme.livekit.cloud')
    }

    await expect(issueCallToken(call.id, restricted)).rejects.toMatchObject({ code: 'forbidden', status: 403 })
    await endCall(me, call.id)
    expect(lkFetch.mock.calls.some(([u]) => String(u).includes('DeleteRoom'))).toBe(true)
    await expect(issuePublicCallToken(publicId, 'Late Guest')).rejects.toMatchObject({ code: 'closed', status: 410 })
  })

  it('starts a DM call, restricts token & ref access to members, and ends via chat', async () => {
    stubLiveKit()
    const convId = await openDm(me, colleague.id)
    conversationIds.push(convId)

    const { call } = await startConversationCall(me, convId, {
      kind: 'video',
      clientId: crypto.randomUUID(),
    })
    callIds.push(call.id)
    expect(call.conversationId).toBe(convId)
    expect(call.provider).toBe('livekit')

    const peerToken = await issueCallToken(call.id, colleague)
    expect(peerToken.provider).toBe('livekit')

    await expect(issueCallToken(call.id, outsider)).rejects.toMatchObject({ code: 'not_found', status: 404 })
    await expect(issueCallToken(call.id, restricted)).rejects.toMatchObject({ code: 'forbidden', status: 403 })

    const peerPreview = await previewRef(colleague, 'call', call.id)
    expect(peerPreview).toMatchObject({ kind: 'video', status: 'open', conversationId: convId })

    const peerMessages = await listMessages(colleague, convId, { limit: 10 })
    const callMessage = peerMessages.messages.find((m) => m.refs.some((r) => r.type === 'call' && r.refId === call.id))
    expect(callMessage?.refs[0]).toMatchObject({ canOpen: true, card: { kind: 'video', status: 'open' } })

    await expect(previewRef(outsider, 'call', call.id)).rejects.toThrow()

    const declined = await declineConversationCall(colleague, call.id)
    expect(declined).toMatchObject({ conversationId: convId, callId: call.id })

    await endConversationCall(colleague, call.id)
    const afterEndMessages = await listMessages(colleague, convId, { limit: 10 })
    const afterEndCallMsg = afterEndMessages.messages.find((m) => m.refs.some((r) => r.type === 'call' && r.refId === call.id))
    expect(afterEndCallMsg?.refs[0]?.card).toMatchObject({ status: 'ended' })
  })

  it('closes a Mesaje call once everyone has left, but not while someone is in it or it still rings', async () => {
    stubLiveKit()
    const convId = await openDm(me, colleague.id)
    conversationIds.push(convId)
    const { call } = await startConversationCall(me, convId, { kind: 'audio', clientId: crypto.randomUUID() })
    callIds.push(call.id)
    const status = async () => (await db.select({ status: calls.status }).from(calls).where(eq(calls.id, call.id)))[0]?.status
    const later = new Date(Date.now() + 3 * 60_000)

    // Still ringing: too new to judge.
    await runEmptyCallsClose(new Date())
    expect(await status()).toBe('open')

    stubLiveKit([{ name: call.id, numParticipants: 1 }])
    await runEmptyCallsClose(later)
    expect(await status()).toBe('open')

    stubLiveKit([])
    expect(await runEmptyCallsClose(later)).toBeGreaterThanOrEqual(1)
    expect(await status()).toBe('ended')
  })
})
