import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { calendarEventAttendees, calendarEventExceptions, calendarEventReminders, calendarEvents } from '../../shared/db/schema/index.js'

// Undo for every calendar write (PLAN.md BE3). The inverse of "this and following" cannot be
// derived on the client (it splits a series and creates rows), so the server keeps the state
// of the touched series before the write and puts it back. Kept in memory: one process on the
// VPS, and the undo toast lasts 8s, so losing tokens on a restart costs nothing.

const TTL_MS = 60_000

type EventRow = typeof calendarEvents.$inferSelect
type ExceptionRow = typeof calendarEventExceptions.$inferSelect
type ReminderRow = typeof calendarEventReminders.$inferSelect
type AttendeeRow = typeof calendarEventAttendees.$inferSelect

interface Snapshot {
  eventIds: string[]
  events: EventRow[]
  exceptions: ExceptionRow[]
  reminders: ReminderRow[]
  attendees: AttendeeRow[]
}

interface Entry {
  userId: string
  expiresAt: number
  before: Snapshot
  /** Series created by the write, deleted on revert. */
  createdIds: string[]
}

const entries = new Map<string, Entry>()

function sweep(now: number) {
  for (const [token, entry] of entries) if (entry.expiresAt <= now) entries.delete(token)
}

export async function takeSnapshot(eventIds: string[]): Promise<Snapshot> {
  if (eventIds.length === 0) return { eventIds, events: [], exceptions: [], reminders: [], attendees: [] }
  const [events, exceptions, reminders, attendees] = await Promise.all([
    db.select().from(calendarEvents).where(inArray(calendarEvents.id, eventIds)),
    db.select().from(calendarEventExceptions).where(inArray(calendarEventExceptions.eventId, eventIds)),
    db.select().from(calendarEventReminders).where(inArray(calendarEventReminders.eventId, eventIds)),
    db.select().from(calendarEventAttendees).where(inArray(calendarEventAttendees.eventId, eventIds)),
  ])
  return { eventIds, events, exceptions, reminders, attendees }
}

export function storeRevert(userId: string, before: Snapshot, createdIds: string[]): string {
  const now = Date.now()
  sweep(now)
  const token = randomUUID()
  entries.set(token, { userId, expiresAt: now + TTL_MS, before, createdIds })
  return token
}

/** False when the token expired or belongs to someone else (the route answers 404 either way). */
export async function applyRevert(userId: string, token: string): Promise<boolean> {
  sweep(Date.now())
  const entry = entries.get(token)
  if (!entry || entry.userId !== userId) return false
  entries.delete(token)
  const { before, createdIds } = entry

  await db.transaction(async (tx) => {
    // Child rows go in full: delete what is there now, put back what was there before.
    if (before.eventIds.length > 0) {
      await tx.delete(calendarEventExceptions).where(inArray(calendarEventExceptions.eventId, before.eventIds))
      await tx.delete(calendarEventReminders).where(inArray(calendarEventReminders.eventId, before.eventIds))
      await tx.delete(calendarEventAttendees).where(inArray(calendarEventAttendees.eventId, before.eventIds))
    }
    // Created series disappear with their children (FK cascade).
    if (createdIds.length > 0) await tx.delete(calendarEvents).where(inArray(calendarEvents.id, createdIds))
    for (const event of before.events) {
      const { id, ...fields } = event
      await tx.update(calendarEvents).set(fields).where(inArray(calendarEvents.id, [id]))
    }
    if (before.exceptions.length > 0) await tx.insert(calendarEventExceptions).values(before.exceptions)
    if (before.reminders.length > 0) await tx.insert(calendarEventReminders).values(before.reminders)
    if (before.attendees.length > 0) await tx.insert(calendarEventAttendees).values(before.attendees)
  })
  return true
}
