import { z } from 'zod'
import { lazyTr } from '../../shared/lib/i18n.js'

const eventFields = {
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().optional(),
  location: z.string().trim().optional(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  allDay: z.boolean().optional(),
  recurrenceRule: z.string().trim().min(1).optional(),
  recurrenceEndAt: z.coerce.date().optional(),
  color: z.string().trim().optional(),
  // Old single reminder, still accepted from APK builds and the assistant; `reminders` wins.
  reminderMinutesBefore: z.number().int().positive().max(1440).nullable().optional(),
  reminders: z.array(z.number().int().min(0).max(40320)).max(5).optional(),
}

// `attendeeUserIds` = evenimentul comun (apare în calendarul fiecărui participant). Trimis
// doar de cine are `calendar.comune` — serverul refuză altfel, deci câmpul nu e o poartă.
export const CreateEventSchema = z
  .object({
    ...eventFields,
    attendeeUserIds: z.array(z.string().uuid()).max(50).optional(),
    // Calendarul în care intră evenimentul, dacă nu e al omului: cazul secretarului care face
    // programări în calendarul lui Stefan. Cere „editează" pe acel calendar (service).
    calendarOwnerUserId: z.string().uuid().optional(),
  })
  .refine((v) => v.endAt >= v.startAt, {
    message: lazyTr('errors.calendar.endAfterStart'),
    path: ['endAt'],
  })

export const UpdateEventSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().nullable().optional(),
  location: z.string().trim().nullable().optional(),
  startAt: z.coerce.date().optional(),
  endAt: z.coerce.date().optional(),
  allDay: z.boolean().optional(),
  // null = șterge recurența (devine eveniment unic)
  recurrenceRule: z.string().trim().min(1).nullable().optional(),
  recurrenceEndAt: z.coerce.date().nullable().optional(),
  color: z.string().trim().nullable().optional(),
  reminderMinutesBefore: z.number().int().positive().max(1440).nullable().optional(),
  reminders: z.array(z.number().int().min(0).max(40320)).max(5).optional(),
  attendeeUserIds: z.array(z.string().uuid()).max(50).optional(),
})

/** Which part of a series a write touches; `occurrence` is the occurrence's key. */
export const SeriesScopeQuerySchema = z.object({
  scope: z.enum(['occurrence', 'following', 'all']).optional(),
  occurrence: z.coerce.date().optional(),
})

export const DuplicateEventSchema = z.object({
  occurrence: z.coerce.date().optional(),
})

export const SearchEventsQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
})

export const CreateCalendarShareSchema = z.object({
  ownerUserId: z.string().uuid(),
  userId: z.string().uuid(),
  level: z.enum(['view', 'edit']),
})

export const ListOccurrencesQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
})
