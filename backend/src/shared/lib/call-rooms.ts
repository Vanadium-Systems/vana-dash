import { randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { calls } from '../db/schema/index.js'
import { config } from '../config.js'
import { encryptField } from './crypto.js'
import { createRoom as createDailyRoom, deleteRoom as deleteDailyRoom, isDailyConfigured } from './daily.js'
import { createLiveKitRoom, deleteLiveKitRoom, isLiveKitConfigured } from './livekit.js'

// Shared by modules/calls, modules/chat and modules/booking, so none imports the others.

export type CallRecord = typeof calls.$inferSelect

/** The link people get: our domain and our texts, never the SFU URL. */
export function callPublicUrl(publicId: string): string {
  return `${config.frontendOrigin}/apel/${publicId}`
}

export async function isCallsConfigured(): Promise<boolean> {
  return (await isLiveKitConfigured()) || isDailyConfigured()
}

export async function openCallRoom(input: {
  title: string
  exp: Date
  nbf?: Date
  scheduledAt?: Date
  kind?: 'audio' | 'video'
  conversationId?: string | null
  createdByUserId?: string | null
  guestKey?: string | null
  bookingId?: string
  prospectId?: string | null
  billingClientId?: string | null
}): Promise<CallRecord> {
  const roomName = randomBytes(18).toString('base64url')
  const useLiveKit = await isLiveKitConfigured()
  const provider: 'livekit' | 'daily' = useLiveKit ? 'livekit' : 'daily'
  let roomUrl: string | null = null

  if (useLiveKit) {
    const emptyTimeoutSeconds = Math.max(600, Math.min(8 * 3600, Math.round((input.exp.getTime() - Date.now()) / 1000)))
    await createLiveKitRoom({ name: roomName, emptyTimeoutSeconds, maxParticipants: 20 })
  } else {
    const room = await createDailyRoom({ name: roomName, nbf: input.nbf, exp: input.exp })
    roomUrl = room.url
  }

  const guestKeyEnc = input.guestKey ? await encryptField(input.guestKey) : null
  try {
    const [row] = await db
      .insert(calls)
      .values({
        title: input.title,
        roomName,
        roomUrl,
        publicId: randomBytes(12).toString('base64url'),
        kind: input.kind ?? 'video',
        provider,
        conversationId: input.conversationId ?? null,
        createdByUserId: input.createdByUserId ?? null,
        guestKeyEnc,
        scheduledAt: input.scheduledAt ?? null,
        expiresAt: input.exp,
        bookingId: input.bookingId ?? null,
        prospectId: input.prospectId ?? null,
        billingClientId: input.billingClientId ?? null,
      })
      .returning()
    return row!
  } catch (err) {
    // A room without a row would never be closed.
    if (useLiveKit) await deleteLiveKitRoom(roomName).catch(() => undefined)
    else await deleteDailyRoom(roomName).catch(() => undefined)
    throw err
  }
}

/** Deletes the room (everyone is removed) and marks the call. A closed call is returned as it is. */
export async function closeCallRoom(
  call: CallRecord,
  status: 'ended' | 'cancelled',
  stats?: { durationSeconds?: number; participantCount?: number } | null,
): Promise<CallRecord> {
  if (call.status !== 'open') return call
  if (call.provider === 'livekit') await deleteLiveKitRoom(call.roomName)
  else await deleteDailyRoom(call.roomName)
  const now = new Date()
  const [row] = await db
    .update(calls)
    .set({ status, roomDeletedAt: now, updatedAt: now, ...(stats ?? {}) })
    .where(eq(calls.id, call.id))
    .returning()
  return row!
}

export async function findBookingCall(bookingId: string): Promise<CallRecord | null> {
  const [row] = await db
    .select()
    .from(calls)
    .where(and(eq(calls.bookingId, bookingId), isNull(calls.deletedAt)))
  return row ?? null
}
