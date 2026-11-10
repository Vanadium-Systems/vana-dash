import { db } from '../db/client.js'
import { calendarEvents } from '../db/schema/index.js'
import { createdByUserId, updatedByUserId } from './audit.js'

interface NewCalendarEvent {
  ownerUserId: string
  title: string
  startAt: Date
  endAt: Date
  description?: string | null
}

/** A plain one-off event in someone's calendar, for modules that must not import `modules/calendar`.
 *  Pass the transaction as `executor` to keep it atomic with the caller's own writes. */
export async function createCalendarEvent(
  event: NewCalendarEvent,
  executor: Pick<typeof db, 'insert'> = db,
): Promise<string> {
  const [row] = await executor
    .insert(calendarEvents)
    .values({ ...createdByUserId(), ...updatedByUserId(), ...event })
    .returning({ id: calendarEvents.id })
  if (!row) throw new Error('calendar event insert returned nothing')
  return row.id
}
