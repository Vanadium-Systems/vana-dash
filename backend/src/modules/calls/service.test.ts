/**
 * Calls against the real DB, with LiveKit & Daily HTTP stubbed: the guest view says nothing about
 * who the call is for, a closed call cannot be joined, tokens enforce membership/features,
 * livekit_settings encrypts credentials at rest, and the close job cleans expired rooms.
 */
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from '../../shared/db/client.js'
import { calls, conversations, livekitSettings } from '../../shared/db/schema/index.js'
import type { SessionUser } from '../../shared/lib/session.js'
import { getLiveKitSettingsView, saveLiveKitSettings } from '../../shared/lib/livekit.js'
import { cleanupTestUsers, createTestUser } from '../../shared/testing/users.js'
import { runCallsClose } from '../../jobs/calls-close.js'
import { declineConversationCall, endConversationCall, listMessages, openDm, previewRef, startConversationCall } from '../chat/service.js'
import './refs.js'
import { CallError, createCall, endCall, getPublicCall, issueCallToken, issuePublicCallToken, joinCall, listCalls } from './service.js'

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
  it('creates a call whose row shows our link, never the Daily room', async () => {
    stubDaily()
    const call = await createCall(me, { title: 'Acme intro', expiresInHours: 2 })
    callIds.push(call.id)

    expect(call.status).toBe('open')
    expect(call.publicUrl).toMatch(/\/apel\/[A-Za-z0-9_-]{16}$/)
    expect(JSON.stringify(call)).not.toContain('daily.co')
    expect((await listCalls(me, { status: 'open', limit: 200 })).some((row) => row.id === call.id)).toBe(true)
  })

  it('the guest view of an open call has the room and nothing about who it is for', async () => {
    stubDaily()
    const call = await createCall(me, { title: 'Acme pricing', expiresInHours: 1 })
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
    const call = await createCall(me, { title: 'Acme follow-up', expiresInHours: 1 })
    callIds.push(call.id)

    expect((await joinCall(call.id, me)).token).toBe('owner-token')
    expect((await endCall(me, call.id)).status).toBe('ended')
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
    const call = await createCall(me, { title: 'Acme expired', expiresInHours: 1 })
    callIds.push(call.id)

    expect(await runCallsClose(new Date(Date.now() + 2 * 3_600_000))).toBeGreaterThanOrEqual(1)
    const [row] = await db.select().from(calls).where(inArray(calls.id, [call.id]))
    expect(row).toMatchObject({ status: 'ended', durationSeconds: 900, participantCount: 3 })
    expect(row?.roomDeletedAt).not.toBeNull()
  })
})

describe('livekit calls & chat integration', () => {
  beforeAll(async () => {
    await saveLiveKitSettings({
      url: 'https://acme.livekit.cloud/',
      apiKey: 'APIacmeTestKey1234',
      apiSecret: 'acme-test-secret-0123456789abcdef012345',
      enabled: true,
    })
  })

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
})
