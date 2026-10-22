/**
 * Daily client: one request per call, the key only in the Authorization header, every
 * failure turned into a DailyError that never leaks the key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config.js'
import { createOwnerToken, createRoom, DailyError, deleteRoom, getMeetings } from './daily.js'

const KEY = 'test-key'
const NBF = new Date('2026-01-01T10:00:00Z')
const EXP = new Date('2026-01-01T12:00:00Z')

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  config.daily.apiKey = KEY
})

afterEach(() => {
  config.daily.apiKey = ''
  vi.unstubAllGlobals()
})

describe('createRoom', () => {
  it('POSTs the room with the time window and Prebuilt properties, nbf/exp in seconds', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(jsonResponse({ name: 'r1', url: 'https://acme.daily.co/r1' })),
    )
    vi.stubGlobal('fetch', fetchMock)

    const room = await createRoom({ name: 'r1', nbf: NBF, exp: EXP })

    expect(room).toEqual({ name: 'r1', url: 'https://acme.daily.co/r1' })
    const [url, init] = fetchMock.mock.calls[0] ?? ['', {} as RequestInit]
    expect(url).toBe('https://api.daily.co/v1/rooms')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'r1',
      privacy: 'public',
      properties: {
        nbf: 1767261600,
        exp: 1767268800,
        eject_at_room_exp: true,
        max_participants: 10,
        enable_screenshare: true,
        enable_prejoin_ui: true,
        enable_chat: true,
        geo: 'eu-central-1',
        lang: 'user',
      },
    })
  })

  it('omits nbf entirely when the room has no start bound', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(jsonResponse({ name: 'r1', url: 'https://acme.daily.co/r1' })),
    )
    vi.stubGlobal('fetch', fetchMock)

    await createRoom({ name: 'r1', exp: EXP })

    const properties = JSON.parse(String(fetchMock.mock.calls[0]?.[1].body)).properties
    expect('nbf' in properties).toBe(false)
    expect(properties.exp).toBe(1767268800)
  })

  it('keeps the key in the Authorization header and out of the URL and the body', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(jsonResponse({ name: 'r1', url: 'https://acme.daily.co/r1' })),
    )
    vi.stubGlobal('fetch', fetchMock)

    await createRoom({ name: 'r1', nbf: NBF, exp: EXP })

    const [url, init] = fetchMock.mock.calls[0] ?? ['', {} as RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
    expect(url).not.toContain(KEY)
    expect(String(init.body)).not.toContain(KEY)
  })

  it('passes an AbortSignal to every request', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve(jsonResponse({ name: 'r1', url: 'https://acme.daily.co/r1' })),
    )
    vi.stubGlobal('fetch', fetchMock)

    await createRoom({ name: 'r1', nbf: NBF, exp: EXP })
    await deleteRoom('r1')
    await getMeetings('r1')
    await createOwnerToken('r1', EXP, 'Ana · Acme')

    for (const [, init] of fetchMock.mock.calls) expect(init.signal).toBeDefined()
    expect(fetchMock.mock.calls.length).toBe(4)
  })

  it('fails without a key, without ever reaching Daily', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ name: 'r1' })))
    vi.stubGlobal('fetch', fetchMock)
    config.daily.apiKey = ''

    await expect(createRoom({ name: 'r1', exp: EXP })).rejects.toBeInstanceOf(DailyError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects with the status Daily answers with', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ error: 'rate limited' }, 500))))
    const error = await createRoom({ name: 'r1', exp: EXP }).catch((e) => e)
    expect(error).toBeInstanceOf(DailyError)
    expect((error as DailyError).status).toBe(500)
  })
})

describe('deleteRoom', () => {
  it('resolves on 200 and treats a 404 as "the room is already gone"', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(jsonResponse({}, 200)))
    vi.stubGlobal('fetch', fetchMock)
    await expect(deleteRoom('r1')).resolves.toBeUndefined()

    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ error: 'not found' }, 404)))
    await expect(deleteRoom('r1')).resolves.toBeUndefined()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.daily.co/v1/rooms/r1')
  })

  it('rejects with the status Daily answers with', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ error: 'boom' }, 500))))
    const error = await deleteRoom('r1').catch((e) => e)
    expect(error).toBeInstanceOf(DailyError)
    expect((error as DailyError).status).toBe(500)
  })
})

describe('transport failures', () => {
  it('turns a failed fetch into a DailyError of status 0 that never repeats the key', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('fetch failed'))))

    const error = await createRoom({ name: 'r1', exp: EXP }).catch((e) => e)
    expect(error).toBeInstanceOf(DailyError)
    expect((error as DailyError).status).toBe(0)
    expect((error as Error).message).not.toContain(KEY)
  })
})

describe('getMeetings', () => {
  it('returns null when the room was never opened', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ data: [] }))))
    expect(await getMeetings('r1')).toBeNull()
  })

  it('sums the duration and takes the largest number of participants', async () => {
    const meetings = { data: [{ duration: 600, max_participants: 2 }, { duration: 300, max_participants: 3 }] }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse(meetings))))
    expect(await getMeetings('r1')).toEqual({ durationSeconds: 900, participantCount: 3 })
  })
})

describe('createOwnerToken', () => {
  it('issues an owner token for the room and returns it', async () => {
    const fetchMock = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(jsonResponse({ token: 'tok_1' })))
    vi.stubGlobal('fetch', fetchMock)

    expect(await createOwnerToken('r1', EXP, 'Ana · Acme')).toBe('tok_1')
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1].body))).toEqual({
      properties: { room_name: 'r1', is_owner: true, user_name: 'Ana · Acme', exp: 1767268800 },
    })
  })
})
