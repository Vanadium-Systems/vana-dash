import { z } from 'zod'

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
  // null/absent = fără reminder. Select-ul din UI oferă doar 5/15/30/60, dar nu impunem enum
  // strict aici — un client viitor (sau Stefan direct din API) poate avea nevoie de altă valoare.
  reminderMinutesBefore: z.number().int().positive().max(1440).nullable().optional(),
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
    message: 'endAt trebuie să fie după startAt',
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
  attendeeUserIds: z.array(z.string().uuid()).max(50).optional(),
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
