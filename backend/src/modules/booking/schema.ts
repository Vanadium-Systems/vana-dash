import { z } from 'zod'

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Ora în format HH:mm')

export const BookingSettingsSchema = z
  .object({
    enabled: z.boolean(),
    durationMin: z.number().int().min(15).max(120),
    bufferMin: z.number().int().min(0).max(60),
    minNoticeHours: z.number().int().min(0).max(168),
    horizonDays: z.number().int().min(1).max(60),
    // Ora din București; weekday 1 = luni … 7 = duminică.
    weekly: z
      .array(z.object({ weekday: z.number().int().min(1).max(7), start: hhmm, end: hhmm }))
      .max(28)
      .refine((windows) => windows.every((w) => w.start < w.end), 'Fiecare interval trebuie să se termine după ce începe'),
  })
  .strict()
export type BookingSettings = z.infer<typeof BookingSettingsSchema>

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  enabled: false,
  durationMin: 30,
  bufferMin: 10,
  minNoticeHours: 12,
  horizonDays: 14,
  weekly: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '10:00', end: '16:00' })),
}

export const SlotsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(60).default(14),
})

// Numele ajunge în emailul de confirmare, trimis la o adresă pe care o alege oricine: fără
// linkuri acolo, ca formularul să nu poată fi folosit ca releu de spam către terți.
const noLinks = (value: string) => !/(https?:|www\.|:\/\/|[a-z0-9-]+\.(com|ro|net|org|io|ru|xyz|top|info)\b)/i.test(value)

// Vine de la Function-ul din vana-site, după Turnstile. `consent` confirmă că formularul a
// afișat informarea (docs/BOOKING.md, Legal); nu e temeiul prelucrării.
export const PublicBookingBodySchema = z.object({
  start: z.coerce.date(),
  name: z.string().trim().min(2).max(120).refine(noLinks),
  email: z.string().trim().email().max(254),
  company: z.string().trim().max(160).refine(noLinks).optional(),
  topic: z.string().trim().min(5).max(1000),
  consent: z.literal(true),
})

export const PublicCancelBodySchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
})

export const RangeQuerySchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
})

export const BlockBodySchema = z
  .object({
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.endAt > v.startAt, { message: 'Intervalul trebuie să se termine după ce începe', path: ['endAt'] })

export const IdParamsSchema = z.object({ id: z.string().uuid() })
