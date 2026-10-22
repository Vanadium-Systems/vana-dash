import { randomBytes } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { calls } from '../db/schema/index.js'
import { config } from '../config.js'
import { createRoom, deleteRoom } from './daily.js'

// Shared by modules/calls and modules/booking, so neither imports the other.

export type CallRecord = typeof calls.$inferSelect

/** The link people get: our domain and our texts, not daily.co. */
export function callPublicUrl(publicId: string): string {
  return `${config.frontendOrigin}/apel/${publicId}`
}

export async function openCallRoom(input: {
  title: string
  exp: Date
  nbf?: Date
  scheduledAt?: Date
  bookingId?: string
  prospectId?: string | null
  billingClientId?: string | null
}): Promise<CallRecord> {
  // 18 bytes = 24 base64url characters: the room is public, its name is the lock.
  const room = await createRoom({ name: randomBytes(18).toString('base64url'), nbf: input.nbf, exp: input.exp })
  try {
    const [row] = await db
      .insert(calls)
      .values({
        title: input.title,
        roomName: room.name,
        roomUrl: room.url,
        publicId: randomBytes(12).toString('base64url'),
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
    await deleteRoom(room.name).catch(() => undefined)
    throw err
  }
}

/** Deletes the room (everyone is removed) and marks the call. A closed call is returned as it is. */
export async function closeCallRoom(
  call: CallRecord,
  status: 'ended' | 'cancelled',
  stats?: { durationSeconds: number; participantCount: number } | null,
): Promise<CallRecord> {
  if (call.status !== 'open') return call
  await deleteRoom(call.roomName)
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
