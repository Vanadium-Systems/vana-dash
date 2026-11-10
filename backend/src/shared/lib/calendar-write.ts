import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { calendarEventAttendees, calendarEvents } from '../db/schema/index.js'
import { createdByUserId, updatedByUserId } from './audit.js'

type Executor = Pick<typeof db, 'insert' | 'update' | 'delete'>

interface NewCalendarEvent {
  ownerUserId: string
  title: string
  startAt: Date
  endAt: Date
  description?: string | null
  location?: string | null
  /** Colleagues invited to the event; any attendee row makes it a common event. The owner is implicit. */
  attendeeUserIds?: string[]
}

/** Replaces the attendee rows of an event: the owner is left out (implicit) and ids are deduped. */
async function setAttendees(executor: Executor, eventId: string, ownerUserId: string, attendeeUserIds: string[]) {
  await executor.delete(calendarEventAttendees).where(eq(calendarEventAttendees.eventId, eventId))
  const ids = [...new Set(attendeeUserIds)].filter((id) => id !== ownerUserId)
  if (ids.length > 0) await executor.insert(calendarEventAttendees).values(ids.map((userId) => ({ eventId, userId })))
}

/** A plain one-off event in someone's calendar, for modules that must not import `modules/calendar`.
 *  Pass the transaction as `executor` to keep it atomic with the caller's own writes. */
export async function createCalendarEvent(event: NewCalendarEvent, executor: Executor = db): Promise<string> {
  const { attendeeUserIds, ...values } = event
  const [row] = await executor
    .insert(calendarEvents)
    .values({ ...createdByUserId(), ...updatedByUserId(), ...values })
    .returning({ id: calendarEvents.id })
  if (!row) throw new Error('calendar event insert returned nothing')
  if (attendeeUserIds?.length) await setAttendees(executor, row.id, event.ownerUserId, attendeeUserIds)
  return row.id
}

interface CalendarEventChanges {
  ownerUserId?: string
  title?: string
  startAt?: Date
  endAt?: Date
  location?: string | null
  description?: string | null
  /** Omitted = attendees stay; an array (even empty) replaces them. */
  attendeeUserIds?: string[]
}

export async function updateCalendarEvent(eventId: string, changes: CalendarEventChanges, executor: Executor = db): Promise<void> {
  const { attendeeUserIds, ...fields } = changes
  const [row] = await executor
    .update(calendarEvents)
    .set({ ...fields, ...updatedByUserId(), updatedAt: new Date() })
    .where(and(eq(calendarEvents.id, eventId), isNull(calendarEvents.deletedAt)))
    .returning({ ownerUserId: calendarEvents.ownerUserId })
  if (row && attendeeUserIds) await setAttendees(executor, eventId, row.ownerUserId, attendeeUserIds)
}

export async function deleteCalendarEvent(eventId: string, executor: Executor = db): Promise<void> {
  await executor
    .update(calendarEvents)
    .set({ deletedAt: new Date(), ...updatedByUserId() })
    .where(and(eq(calendarEvents.id, eventId), isNull(calendarEvents.deletedAt)))
}
