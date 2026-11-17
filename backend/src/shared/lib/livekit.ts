import { AccessToken, RoomServiceClient } from 'livekit-server-sdk'
import { sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { livekitSettings } from '../db/schema/index.js'
import { config } from '../config.js'
import { decryptField, encryptField } from './crypto.js'

// LiveKit Cloud client & settings (PLAN.md Part A).
// The API key & secret live encrypted (v1 envelope) in `livekit_settings`, never in responses
// or logs. Optional env vars act only as a fallback for tests or initial bootstrap.

function maskKey(key: string): string {
  return key.length <= 8 ? '••••' : `••••${key.slice(-4)}`
}

const REQUEST_TIMEOUT_SECONDS = 10

export class LiveKitError extends Error {
  constructor(
    readonly status: number,
    readonly operation: string,
  ) {
    // Never include upstream response bodies or credentials in the message.
    super(`LiveKit ${operation} failed (${status})`)
  }
}

export interface LiveKitCredentials {
  url: string
  apiKey: string
  apiSecret: string
}

export interface LiveKitSettingsView {
  url: string
  enabled: boolean
  hasApiKey: boolean
  apiKeyPreview: string | null
  hasApiSecret: boolean
  hasEnvFallback: boolean
  configured: boolean
}

export function toLiveKitHttpUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (trimmed.startsWith('wss://')) return `https://${trimmed.slice(6)}`
  if (trimmed.startsWith('ws://')) return `http://${trimmed.slice(5)}`
  return trimmed
}

export function normalizeLiveKitWsUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (trimmed.startsWith('https://')) return `wss://${trimmed.slice(8)}`
  if (trimmed.startsWith('http://')) return `ws://${trimmed.slice(7)}`
  return trimmed
}

function hasEnvCredentials(): boolean {
  return Boolean(config.livekit.url && config.livekit.apiKey && config.livekit.apiSecret)
}

export async function getLiveKitConfig(): Promise<LiveKitCredentials | null> {
  const [row] = await db.select().from(livekitSettings)
  if (row) {
    if (!row.enabled) return null
    const url = row.url.trim() || config.livekit.url.trim()
    const apiKey = row.apiKeyEnc ? await decryptField(row.apiKeyEnc) : config.livekit.apiKey
    const apiSecret = row.apiSecretEnc ? await decryptField(row.apiSecretEnc) : config.livekit.apiSecret
    if (url && apiKey && apiSecret) return { url: normalizeLiveKitWsUrl(url), apiKey, apiSecret }
    return null
  }
  if (hasEnvCredentials()) {
    return {
      url: normalizeLiveKitWsUrl(config.livekit.url),
      apiKey: config.livekit.apiKey,
      apiSecret: config.livekit.apiSecret,
    }
  }
  return null
}

export async function isLiveKitConfigured(): Promise<boolean> {
  return (await getLiveKitConfig()) !== null
}

export async function getLiveKitSettingsView(): Promise<LiveKitSettingsView> {
  const [row] = await db.select().from(livekitSettings)
  let apiKeyPreview: string | null = null
  if (row?.apiKeyEnc) {
    try {
      apiKeyPreview = maskKey(await decryptField(row.apiKeyEnc))
    } catch {
      apiKeyPreview = null
    }
  }
  const envFallback = hasEnvCredentials()
  const enabled = row?.enabled ?? true
  const url = row?.url || config.livekit.url
  const configured =
    enabled &&
    Boolean((row?.url.trim() || config.livekit.url.trim()) && (row?.apiKeyEnc || config.livekit.apiKey) && (row?.apiSecretEnc || config.livekit.apiSecret))

  return {
    url,
    enabled,
    hasApiKey: Boolean(row?.apiKeyEnc),
    apiKeyPreview,
    hasApiSecret: Boolean(row?.apiSecretEnc),
    hasEnvFallback: envFallback,
    configured,
  }
}

export async function saveLiveKitSettings(input: {
  url: string
  apiKey?: string | null
  apiSecret?: string | null
  enabled: boolean
}): Promise<LiveKitSettingsView> {
  const [existing] = await db.select().from(livekitSettings)
  const nextKeyEnc =
    input.apiKey === undefined
      ? (existing?.apiKeyEnc ?? null)
      : input.apiKey === null || input.apiKey.trim() === ''
        ? null
        : await encryptField(input.apiKey.trim())
  const nextSecretEnc =
    input.apiSecret === undefined
      ? (existing?.apiSecretEnc ?? null)
      : input.apiSecret === null || input.apiSecret.trim() === ''
        ? null
        : await encryptField(input.apiSecret.trim())

  const url = input.url.trim()
  await db
    .insert(livekitSettings)
    .values({
      url,
      apiKeyEnc: nextKeyEnc,
      apiSecretEnc: nextSecretEnc,
      enabled: input.enabled,
    })
    .onConflictDoUpdate({
      target: [livekitSettings.tenantId],
      set: {
        url: sql`excluded.url`,
        apiKeyEnc: sql`excluded.api_key_enc`,
        apiSecretEnc: sql`excluded.api_secret_enc`,
        enabled: sql`excluded.enabled`,
        updatedAt: new Date(),
      },
    })

  return getLiveKitSettingsView()
}

function makeRoomClient(creds: LiveKitCredentials): RoomServiceClient {
  return new RoomServiceClient(toLiveKitHttpUrl(creds.url), creds.apiKey, creds.apiSecret, {
    requestTimeout: REQUEST_TIMEOUT_SECONDS,
    failover: false,
  })
}

function statusFromError(err: unknown): number {
  if (typeof err === 'object' && err !== null) {
    const candidate = err as { status?: number; code?: string | number }
    if (typeof candidate.status === 'number') return candidate.status
    if (candidate.code === 'not_found') return 404
    if (candidate.code === 'unauthenticated' || candidate.code === 'permission_denied') return 401
    if (candidate.code === 'resource_exhausted') return 429
  }
  const msg = err instanceof Error ? err.message.toLowerCase() : ''
  if (msg.includes('not found') || msg.includes('does not exist') || msg.includes('404')) return 404
  if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('invalid token')) return 401
  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota')) return 429
  return 0
}

export async function createLiveKitRoom(input: {
  name: string
  emptyTimeoutSeconds?: number
  maxParticipants?: number
}): Promise<{ name: string; url: string }> {
  const creds = await getLiveKitConfig()
  if (!creds) throw new LiveKitError(0, 'createRoom')
  const client = makeRoomClient(creds)
  try {
    await client.createRoom({
      name: input.name,
      emptyTimeout: input.emptyTimeoutSeconds ?? 1800,
      departureTimeout: 60,
      maxParticipants: input.maxParticipants ?? 20,
    })
    return { name: input.name, url: creds.url }
  } catch (err) {
    throw new LiveKitError(statusFromError(err), 'createRoom')
  }
}

/** 404 means the room has already expired or been deleted: not an error. */
export async function deleteLiveKitRoom(name: string): Promise<void> {
  const creds = await getLiveKitConfig()
  if (!creds) return
  const client = makeRoomClient(creds)
  try {
    await client.deleteRoom(name)
  } catch (err) {
    const status = statusFromError(err)
    if (status === 404) return
    throw new LiveKitError(status, 'deleteRoom')
  }
}

export async function getLiveKitRoomStats(name: string): Promise<{ participantCount: number } | null> {
  const creds = await getLiveKitConfig()
  if (!creds) return null
  const client = makeRoomClient(creds)
  try {
    const rooms = await client.listRooms([name])
    const room = rooms[0]
    if (!room) return null
    return { participantCount: room.numParticipants }
  } catch (err) {
    const status = statusFromError(err)
    if (status === 404) return null
    throw new LiveKitError(status, 'listRooms')
  }
}

export async function createLiveKitToken(input: {
  roomName: string
  identity: string
  name: string
  isHost: boolean
  ttlSeconds: number
}): Promise<{ token: string; livekitUrl: string }> {
  const creds = await getLiveKitConfig()
  if (!creds) throw new LiveKitError(0, 'createToken')

  const at = new AccessToken(creds.apiKey, creds.apiSecret, {
    identity: input.identity,
    name: input.name,
    ttl: Math.max(60, Math.min(input.ttlSeconds, 8 * 3600)),
  })
  at.addGrant({
    roomJoin: true,
    room: input.roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: input.isHost,
  })
  return { token: await at.toJwt(), livekitUrl: creds.url }
}

export async function testLiveKitConnection(override?: {
  url?: string
  apiKey?: string
  apiSecret?: string
}): Promise<{ ok: true; roomCount: number }> {
  const base = await getLiveKitConfig()
  const url = override?.url?.trim() || base?.url || ''
  const apiKey = override?.apiKey?.trim() || base?.apiKey || ''
  const apiSecret = override?.apiSecret?.trim() || base?.apiSecret || ''
  if (!url || !apiKey || !apiSecret) throw new LiveKitError(0, 'testConnection')
  const client = makeRoomClient({ url: normalizeLiveKitWsUrl(url), apiKey, apiSecret })
  try {
    const rooms = await client.listRooms()
    return { ok: true, roomCount: rooms.length }
  } catch (err) {
    throw new LiveKitError(statusFromError(err), 'testConnection')
  }
}
