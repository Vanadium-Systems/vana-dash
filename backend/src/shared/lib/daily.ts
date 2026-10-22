import { config } from '../config.js'

// The only place that talks to Daily (daily.co). One request at a time, a 10 s timeout on each,
// no retry loop. The key travels only in the Authorization header: never in a log, an error
// message or a response.

const API = 'https://api.daily.co/v1'
const TIMEOUT_MS = 10_000

export class DailyError extends Error {
  constructor(
    readonly status: number,
    readonly operation: string,
  ) {
    // No response body in the message: it could echo request details back.
    super(`Daily ${operation} failed (${status})`)
  }
}

export function isDailyConfigured(): boolean {
  return Boolean(config.daily.apiKey)
}

// Everything goes through this one fetch( so the timeout, the key and the 10 s limit live in one place.
async function dailyFetch(operation: string, path: string, init: { method: string; body?: unknown }): Promise<Response> {
  if (!config.daily.apiKey) throw new DailyError(0, operation)
  let res: Response
  try {
    res = await fetch(`${API}${path}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${config.daily.apiKey}`, 'Content-Type': 'application/json' },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new DailyError(0, operation)
  }
  return res
}

/** Seconds since the epoch, the unit Daily uses for nbf / exp. */
const epoch = (date: Date) => Math.floor(date.getTime() / 1000)

export async function createRoom(input: { name: string; nbf?: Date; exp: Date }): Promise<{ name: string; url: string }> {
  const res = await dailyFetch('createRoom', '/rooms', {
    method: 'POST',
    body: {
      name: input.name,
      privacy: 'public',
      properties: {
        ...(input.nbf ? { nbf: epoch(input.nbf) } : {}),
        exp: epoch(input.exp),
        eject_at_room_exp: true,
        max_participants: 10,
        enable_screenshare: true,
        enable_prejoin_ui: true,
        enable_chat: true,
        geo: 'eu-central-1',
        lang: 'user',
      },
    },
  })
  if (!res.ok) throw new DailyError(res.status, 'createRoom')
  const room = (await res.json()) as { name: string; url: string }
  return { name: room.name, url: room.url }
}

/** 404 means the room is already gone (expired or deleted): not an error. */
export async function deleteRoom(name: string): Promise<void> {
  const res = await dailyFetch('deleteRoom', `/rooms/${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) throw new DailyError(res.status, 'deleteRoom')
}

export async function createOwnerToken(roomName: string, exp: Date, userName: string): Promise<string> {
  const res = await dailyFetch('createOwnerToken', '/meeting-tokens', {
    method: 'POST',
    body: { properties: { room_name: roomName, is_owner: true, user_name: userName, exp: epoch(exp) } },
  })
  if (!res.ok) throw new DailyError(res.status, 'createOwnerToken')
  const { token } = (await res.json()) as { token: string }
  return token
}

/** Total duration and the largest number of people at once, over all sessions of the room. */
export async function getMeetings(roomName: string): Promise<{ durationSeconds: number; participantCount: number } | null> {
  const res = await dailyFetch('getMeetings', `/meetings?room=${encodeURIComponent(roomName)}`, { method: 'GET' })
  if (!res.ok) throw new DailyError(res.status, 'getMeetings')
  const { data } = (await res.json()) as { data?: Array<{ duration?: number; max_participants?: number }> }
  if (!data || data.length === 0) return null
  return {
    durationSeconds: data.reduce((sum, m) => sum + (m.duration ?? 0), 0),
    participantCount: Math.max(...data.map((m) => m.max_participants ?? 0)),
  }
}
