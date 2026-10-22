import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gte, inArray, isNull, lt, lte, sql } from 'drizzle-orm'
import { db } from '../../shared/db/client.js'
import { bookingBlocks, bookings, calendarEvents, calls, dashboardConfig, users } from '../../shared/db/schema/index.js'
import { listOccurrencesForOwner } from '../../shared/lib/calendar-occurrences.js'
import { config } from '../../shared/config.js'
import { sendEmail } from '../../shared/lib/email.js'
import { notifyPush } from '../../shared/lib/push.js'
import { bucharestTimeToUtc, wallClock } from '../../shared/lib/schedule-recurrence.js'
import { buildBookingIcs } from './ics.js'
import { BookingSettingsSchema, DEFAULT_BOOKING_SETTINGS, type BookingSettings, type PublicBookingBodySchema } from './schema.js'
import { allDayToInterval, computeSlots, type Interval, type Slot } from './slots.js'
import type { z } from 'zod'
import { tl, tr, trFor } from '../../shared/lib/i18n.js'
import { ensureAlertRule, raiseAlert } from '../../shared/lib/alerting.js'
import { callPublicUrl, closeCallRoom, findBookingCall, openCallRoom } from '../../shared/lib/call-rooms.js'
import { isDailyConfigured } from '../../shared/lib/daily.js'
import { INTL_TAG, isLocale, type Locale } from '../../shared/lib/locale.js'

const SETTINGS_KEY = 'booking.settings'
// Plafonul de rezervări noi pe zi (Contract D): o limită peste Turnstile și rate limit, ca un
// atac reușit să nu umple calendarul.
export const DAILY_BOOKING_CAP = 5
const DAY_MS = 24 * 60 * 60 * 1000

type PublicBookingInput = z.infer<typeof PublicBookingBodySchema>

export class BookingError extends Error {
  constructor(
    readonly code: 'slot_taken' | 'daily_cap' | 'not_found' | 'too_late',
    readonly status: number,
  ) {
    super(code)
  }
}

/**
 * Programările publice de pe site rămân pe calendarul lui Stefan (decizie Stefan, 2026-09-30):
 * sloturile libere se calculează doar din calendarul lui, iar evenimentul creat de o rezervare
 * intră tot acolo. Un eveniment comun la care e participant îl face ocupat.
 */
let bookingOwnerIdCache: string | null = null

async function bookingOwnerId(): Promise<string> {
  if (bookingOwnerIdCache) return bookingOwnerIdCache
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isPlatformAdmin, true), isNull(users.deletedAt)))
  if (!owner) throw new Error(tr('errors.booking.noOwnerAccount'))
  bookingOwnerIdCache = owner.id
  return owner.id
}

export async function getSettings(): Promise<BookingSettings> {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, SETTINGS_KEY))
  const parsed = BookingSettingsSchema.safeParse({ ...DEFAULT_BOOKING_SETTINGS, ...((row?.value as object) ?? {}) })
  return parsed.success ? parsed.data : DEFAULT_BOOKING_SETTINGS
}

export async function saveSettings(settings: BookingSettings): Promise<BookingSettings> {
  await db
    .insert(dashboardConfig)
    .values({ key: SETTINGS_KEY, value: settings })
    .onConflictDoUpdate({ target: dashboardConfig.key, set: { value: sql`excluded.value`, updatedAt: new Date() } })
  return settings
}

export function listBlocks(from: Date, to: Date) {
  return db
    .select({ id: bookingBlocks.id, startAt: bookingBlocks.startAt, endAt: bookingBlocks.endAt, reason: bookingBlocks.reason })
    .from(bookingBlocks)
    .where(and(isNull(bookingBlocks.deletedAt), lt(bookingBlocks.startAt, to), gte(bookingBlocks.endAt, from)))
    .orderBy(bookingBlocks.startAt)
}

export async function createBlock(input: { startAt: Date; endAt: Date; reason?: string }) {
  const [row] = await db.insert(bookingBlocks).values({ startAt: input.startAt, endAt: input.endAt, reason: input.reason ?? null }).returning()
  return row
}

export async function deleteBlock(id: string): Promise<boolean> {
  const [row] = await db
    .update(bookingBlocks)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(bookingBlocks.id, id), isNull(bookingBlocks.deletedAt)))
    .returning({ id: bookingBlocks.id })
  return Boolean(row)
}

export function listBookings(from: Date, to: Date) {
  return db
    .select({
      id: bookings.id,
      calendarEventId: bookings.calendarEventId,
      start: bookings.startAt,
      end: bookings.endAt,
      name: bookings.name,
      email: bookings.email,
      company: bookings.company,
      topic: bookings.topic,
      status: bookings.status,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .where(and(isNull(bookings.deletedAt), lt(bookings.startAt, to), gte(bookings.endAt, from)))
    .orderBy(bookings.startAt)
}

/**
 * Tot ce face un slot indisponibil: intervalele blocate, orice eveniment din calendar (inclusiv
 * RRULE expandat și zilele întregi) și rezervările confirmate. Cheltuielile recurente apar în
 * calendar ca memento, nu ca timp ocupat, deci nu intră.
 */
async function collectBusy(from: Date, to: Date): Promise<Interval[]> {
  // O ocurență începută înainte de `from` poate încă să se suprapună; RRULE.between vede doar
  // începuturile din fereastră, deci fereastra se lărgește cu o zi.
  const occurrences = await listOccurrencesForOwner(await bookingOwnerId(), new Date(from.getTime() - DAY_MS), to)
  const [blocks, confirmed] = await Promise.all([
    listBlocks(from, to),
    db
      .select({ start: bookings.startAt, end: bookings.endAt })
      .from(bookings)
      .where(and(isNull(bookings.deletedAt), eq(bookings.status, 'confirmed'), lt(bookings.startAt, to), gte(bookings.endAt, from))),
  ])

  const busy: Interval[] = []
  for (const occ of occurrences) {
    if (occ.kind !== 'event') continue
    const start = new Date(occ.occurrenceStart)
    const end = new Date(occ.occurrenceEnd)
    busy.push(occ.allDay ? allDayToInterval(start, end) : { start, end })
  }
  for (const b of blocks) busy.push({ start: b.startAt, end: b.endAt })
  for (const b of confirmed) busy.push({ start: b.start, end: b.end })
  return busy
}

export async function getAvailableSlots(days: number, now = new Date()) {
  const settings = await getSettings()
  const horizonEnd = new Date(now.getTime() + (Math.min(days, settings.horizonDays) + 1) * DAY_MS)
  const slots = settings.enabled ? computeSlots(settings, now, await collectBusy(now, horizonEnd), days) : []
  return {
    timezone: 'Europe/Bucharest',
    durationMin: settings.durationMin,
    slots: slots.map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString() })),
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function isUniqueViolation(err: unknown): boolean {
  const candidate = err as { code?: string; cause?: { code?: string } }
  return candidate?.code === '23505' || candidate?.cause?.code === '23505'
}

/** "Mar 29.09, 10:30" (or "Tue 29/09, 10:30") in Bucharest time, for email subjects and push. */
export function formatSlotLabel(date: Date, locale: Locale = config.defaultLocale): string {
  const tag = INTL_TAG[locale]
  const weekday = new Intl.DateTimeFormat(tag, { weekday: 'short', timeZone: 'Europe/Bucharest' }).format(date).replace('.', '')
  const day = new Intl.DateTimeFormat(tag, { day: '2-digit', month: '2-digit', timeZone: 'Europe/Bucharest' }).format(date)
  const time = new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest' }).format(date)
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${day}, ${time}`
}

function startOfBucharestDay(now: Date): Date {
  const local = wallClock(now)
  return bucharestTimeToUtc(local.y, local.m, local.d, 0, 0)
}

export async function createPublicBooking(input: PublicBookingInput, now = new Date()) {
  const settings = await getSettings()
  const [today] = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(bookings)
    .where(gte(bookings.createdAt, startOfBucharestDay(now)))
  if ((today?.count ?? 0) >= DAILY_BOOKING_CAP) throw new BookingError('daily_cap', 429)

  const requested = input.start.getTime()
  const horizonEnd = new Date(now.getTime() + (settings.horizonDays + 1) * DAY_MS)
  const free = settings.enabled ? computeSlots(settings, now, await collectBusy(now, horizonEnd), settings.horizonDays) : []
  const slot: Slot | undefined = free.find((s) => s.start.getTime() === requested)
  if (!slot) throw new BookingError('slot_taken', 409)

  const cancelToken = randomBytes(32).toString('base64url')
  const titleParts = [input.name, input.company].filter(Boolean).join(', ')
  // Citit înainte de tranzacție: un query în afara ei, ca `tx`-ul să nu primească `db`.
  const ownerUserId = await bookingOwnerId()

  let booking: typeof bookings.$inferSelect
  try {
    booking = await db.transaction(async (tx) => {
      const [event] = await tx
        .insert(calendarEvents)
        .values({
          title: `Apel · ${titleParts}`,
          description: input.topic,
          startAt: slot.start,
          endAt: slot.end,
          source: 'booking',
          ownerUserId,
        })
        .returning({ id: calendarEvents.id })
      const [row] = await tx
        .insert(bookings)
        .values({
          calendarEventId: event!.id,
          startAt: slot.start,
          endAt: slot.end,
          name: input.name,
          email: input.email,
          company: input.company || null,
          topic: input.topic,
          locale: input.locale ?? null,
          createdAt: now,
          consentAt: now,
          cancelTokenHash: hashToken(cancelToken),
        })
        .returning()
      return row!
    })
  } catch (err) {
    // Două cereri simultane pe același slot: indexul unic parțial lasă să treacă doar una.
    if (isUniqueViolation(err)) throw new BookingError('slot_taken', 409)
    throw err
  }

  await notifyAfterBooking(booking, cancelToken)
  return { bookingId: booking.id, start: booking.startAt.toISOString(), end: booking.endAt.toISOString() }
}

/** The call room of a booking. Daily down = the booking stands and the email says the link comes later. */
async function openBookingRoom(booking: typeof bookings.$inferSelect): Promise<string | null> {
  if (!isDailyConfigured()) return null
  try {
    const call = await openCallRoom({
      title: trFor(config.defaultLocale, 'errors.calls.bookingTitle', { name: [booking.name, booking.company].filter(Boolean).join(', ') }),
      nbf: new Date(booking.startAt.getTime() - 15 * 60_000),
      exp: new Date(booking.endAt.getTime() + 60 * 60_000),
      scheduledAt: booking.startAt,
      bookingId: booking.id,
    })
    const url = callPublicUrl(call.publicId)
    if (booking.calendarEventId) {
      await db
        .update(calendarEvents)
        .set({ description: [booking.topic, url].filter(Boolean).join('\n\n'), updatedAt: new Date() })
        .where(eq(calendarEvents.id, booking.calendarEventId))
    }
    return url
  } catch (err) {
    console.error('[booking] call room not created:', err)
    try {
      const ruleId = await ensureAlertRule('calls.room_failed', tr('alerts.rules.callRoomFailed'), 'warning')
      await raiseAlert(ruleId, tl('alerts.jobs.callRoomFailed', { label: formatSlotLabel(booking.startAt) }), {
        severity: 'warning',
        url: '/calls',
        email: false,
      })
    } catch (alertErr) {
      console.error('[booking] alert not raised:', alertErr)
    }
    return null
  }
}

// După commit: eșecul emailului sau al push-ului se loghează, rezervarea rămâne.
// The visitor has no profile: the language comes from the site page they booked on. A site
// language the app has no texts for gets English, which they are more likely to read than the
// installation's default.
function visitorLocale(booking: typeof bookings.$inferSelect): Locale {
  if (!booking.locale) return config.defaultLocale
  return isLocale(booking.locale) ? booking.locale : 'en'
}

function cancelPageUrl(booking: typeof bookings.$inferSelect): string {
  return (booking.locale && config.bookingCancelUrlByLocale[booking.locale]) || config.bookingCancelUrl
}

async function notifyAfterBooking(booking: typeof bookings.$inferSelect, cancelToken: string) {
  const visitor = visitorLocale(booking)
  const label = formatSlotLabel(booking.startAt, visitor)
  const cancelUrl = `${cancelPageUrl(booking)}?t=${encodeURIComponent(cancelToken)}`
  const callUrl = await openBookingRoom(booking)
  await Promise.allSettled([
    sendEmail({
      from: config.emailFromContact,
      to: booking.email!,
      subject: trFor(visitor, 'emails.booking.confirmedSubject', { label }),
      text: [
        trFor(visitor, 'emails.booking.greeting', { name: booking.name }),
        '',
        trFor(visitor, 'emails.booking.scheduled', { label }),
        callUrl ? trFor(visitor, 'emails.booking.callLink', { url: callUrl }) : trFor(visitor, 'emails.booking.linkLater'),
        '',
        trFor(visitor, 'emails.booking.cancelHere', { cancelUrl }),
        '',
        'Stefan',
        'Vanadium Systems',
      ].join('\n'),
      attachments: [{ filename: trFor(visitor, 'emails.booking.icsFilename'), content: Buffer.from(buildBookingIcs(booking, callUrl)) }],
    }),
    // Fără numele vizitatorului: notificarea nativă trece prin Firebase (docs/BOOKING.md, Legal).
    notifyPush('calendarReminder', (locale) => ({
      title: trFor(locale, 'push.booking.newTitle'),
      body: formatSlotLabel(booking.startAt, locale),
      url: '/calendar',
      tag: `booking-${booking.id}`,
    })),
  ]).then((results) => {
    for (const r of results) if (r.status === 'rejected') console.error('[booking] notificare eșuată:', r.reason)
  })
}

async function cancelBooking(booking: typeof bookings.$inferSelect, by: 'visitor' | 'owner', notifyVisitor = true) {
  await db.transaction(async (tx) => {
    await tx.update(bookings).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(bookings.id, booking.id))
    if (booking.calendarEventId) {
      await tx.update(calendarEvents).set({ deletedAt: new Date() }).where(eq(calendarEvents.id, booking.calendarEventId))
    }
  })
  const call = await findBookingCall(booking.id)
  if (call) await closeCallRoom(call, 'cancelled').catch((err) => console.error('[booking] call room not closed:', err))
  const visitor = visitorLocale(booking)
  const label = formatSlotLabel(booking.startAt, visitor)
  await Promise.allSettled([
    booking.email && notifyVisitor
      ? sendEmail({
          from: config.emailFromContact,
          to: booking.email,
          subject: trFor(visitor, 'emails.booking.cancelledSubject', { label }),
          text: [
            trFor(visitor, 'emails.booking.greeting', { name: booking.name }),
            '',
            trFor(visitor, by === 'visitor' ? 'emails.booking.cancelledByVisitor' : 'emails.booking.cancelledByOwner', { label }),
            '',
            'Stefan',
            'Vanadium Systems',
          ].join('\n'),
        })
      : Promise.resolve(),
    by === 'visitor'
      ? notifyPush('calendarReminder', (locale) => ({
          title: trFor(locale, 'push.booking.cancelledTitle'),
          body: formatSlotLabel(booking.startAt, locale),
          url: '/calendar',
        }))
      : Promise.resolve(),
  ])
}

export async function cancelByToken(token: string, now = new Date()) {
  const [booking] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.cancelTokenHash, hashToken(token)), eq(bookings.status, 'confirmed'), isNull(bookings.deletedAt)))
  if (!booking) throw new BookingError('not_found', 404)
  if (booking.startAt.getTime() <= now.getTime()) throw new BookingError('too_late', 410)
  await cancelBooking(booking, 'visitor')
  return { start: booking.startAt.toISOString(), end: booking.endAt.toISOString() }
}

/** `notifyVisitor=false` pentru rezervările evident false: se anulează fără email. */
export async function cancelById(id: string, notifyVisitor = true): Promise<boolean> {
  const [booking] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, id), eq(bookings.status, 'confirmed'), isNull(bookings.deletedAt)))
  if (!booking) return false
  await cancelBooking(booking, 'owner', notifyVisitor)
  return true
}

export const BOOKING_RETENTION_DAYS = 90

/** Contract E: la 90 de zile după apel, datele vizitatorului dispar; rămân ora și statusul. */
export async function purgeExpiredBookings(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - BOOKING_RETENTION_DAYS * DAY_MS)
  return db.transaction(async (tx) => {
    const purged = await tx
      .update(bookings)
      .set({ name: null, email: null, company: null, topic: null, cancelTokenHash: null, personalDataPurgedAt: now, updatedAt: now })
      .where(and(lte(bookings.endAt, cutoff), isNull(bookings.personalDataPurgedAt)))
      .returning({ id: bookings.id, calendarEventId: bookings.calendarEventId })
    for (const { calendarEventId } of purged) {
      if (!calendarEventId) continue
      await tx.update(calendarEvents).set({ title: 'Apel (anonimizat)', description: null, updatedAt: now }).where(eq(calendarEvents.id, calendarEventId))
    }
    if (purged.length > 0) {
      await tx
        .update(calls)
        .set({ title: trFor(config.defaultLocale, 'errors.calls.anonymizedTitle'), updatedAt: now })
        .where(inArray(calls.bookingId, purged.map((p) => p.id)))
    }
    return purged.length
  })
}
