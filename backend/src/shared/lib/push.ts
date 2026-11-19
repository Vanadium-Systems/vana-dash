import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import webpush from 'web-push'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { dashboardConfig, deviceTokens, pushSubscriptions, users } from '../db/schema/index.js'
import { tr } from './i18n.js'
import type { Locale } from './locale.js'
import { httpError } from './http-error.js'

// Wrapper unic pt. Web Push (PLAN.md Sprint 2) — fire-and-forget, niciun `await` blocant pe
// fluxul principal la punctele de integrare. Cheia privată VAPID nu ajunge NICIODATĂ în vreun
// response — doar cea publică, expusă prin GET /api/push/vapid-public-key.

export type PushEventType = 'alerts' | 'email' | 'invoiceStatus' | 'calendarReminder' | 'paymentMatch' | 'mesaje' | 'suport' | 'clienti'

export interface PushPreferences {
  alerts: boolean
  email: boolean
  invoiceStatus: boolean
  calendarReminder: boolean
  paymentMatch: boolean
  mesaje: boolean
  suport: boolean
  clienti: boolean
}

const DEFAULT_PREFERENCES: PushPreferences = {
  alerts: true,
  email: true,
  invoiceStatus: true,
  calendarReminder: true,
  paymentMatch: true,
  // Rândurile salvate înainte de Mesaje nu au cheia, deci merge explicit prin default-uri
  // (getPushPreferences clipează default-ul peste rând) — altfel `undefined` = fals ar
  // opri definitiv pushul pentru oameni, fără niciun semn de ce.
  mesaje: true,
  suport: true,
  clienti: true,
}

const PREFERENCES_KEY = 'push_preferences'

let vapidConfigured = false
function ensureVapid(): boolean {
  if (vapidConfigured) return true
  if (!config.vapid.publicKey || !config.vapid.privateKey) return false
  if (!config.vapid.subject) {
    console.warn('[push] VAPID_SUBJECT is not set: web push is off')
    return false
  }
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey)
  vapidConfigured = true
  return true
}

export async function getPushPreferences(): Promise<PushPreferences> {
  const [row] = await db.select().from(dashboardConfig).where(eq(dashboardConfig.key, PREFERENCES_KEY))
  if (!row) return DEFAULT_PREFERENCES
  return { ...DEFAULT_PREFERENCES, ...(row.value as Partial<PushPreferences>) }
}

export async function setPushPreferences(patch: Partial<PushPreferences>): Promise<PushPreferences> {
  const current = await getPushPreferences()
  const next = { ...current, ...patch }
  await db
    .insert(dashboardConfig)
    .values({ key: PREFERENCES_KEY, value: next })
    .onConflictDoUpdate({
      target: [dashboardConfig.tenantId, dashboardConfig.key],
      set: { value: sql`excluded.value`, updatedAt: new Date() },
    })
  return next
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  /** Android-only (FCM `android.notification.tag`) — identifică notificarea ca să poată fi
   *  ștearsă programatic din bara de notificări la citire (2026-09-03, Stefan: deschidea
   *  emailul în aplicație, notificarea rămânea în bară, trebuia ștearsă manual). Fără tag,
   *  fiecare notificare e independentă, fără niciun handle de care aplicația să se prindă. */
  tag?: string
  /** Web Push only (BE-M5): Megolm ciphertext for browser SW decryption; never sent to FCM. */
  e2e?: { conversationId: string; ciphertext: string; kind: 'dm' | 'group'; byline: string }
  /** An incoming call: the browser shows Answer / Decline, the APK its call screen. */
  call?: { id: string; kind: 'audio' | 'video'; answer: string; decline: string }
}

/**
 * Trimite o notificare push tuturor canalelor configurate, dacă preferința eventType-ului
 * e activă. Fire-and-forget din perspectiva apelantului — nu aruncă niciodată (regula #7
 * CLAUDE.md, failure izolat). Fan-out unic (Contract C): web-push către browsere/PWA + FCM
 * către APK, pe aceleași preferințe — apelanții nu trebuie să știe de canale.
 */
/**
 * Push către oamenii anume — `userIds` gol sau lipsă înseamnă „toți cei care au abonat"
 * (alertele de sistem merg la fel, ca până acum). Email nou, mesaje și ceilalte evenimente
 * personale trec prin aici cu lista explicită (C2).
 */
/**
 * A notification is written for the person who reads it: pass a function and it is called once
 * per language among the recipients. A plain payload goes out as it is (text typed by a
 * person, such as a chat message).
 */
export type PushContent = PushPayload | ((locale: Locale) => PushPayload)

function payloadFor(content: PushContent, locale: Locale | null): PushPayload {
  return typeof content === 'function' ? content(locale ?? config.defaultLocale) : content
}

export async function notifyPush(
  eventType: PushEventType,
  payload: PushContent,
  userIds?: string[],
): Promise<void> {
  await Promise.all([notifyWebPush(eventType, payload, userIds), notifyFcm(eventType, payload, userIds)])
}

async function notifyWebPush(eventType: PushEventType, payload: PushContent, userIds?: string[]): Promise<void> {
  try {
    if (!ensureVapid()) return // VAPID neconfigurat — no-op silențios (pattern RESEND_API_KEY)

    const prefs = await getPushPreferences()
    if (!prefs[eventType]) return

    const subs = await db
      .select({
        id: pushSubscriptions.id,
        ownerUserId: pushSubscriptions.ownerUserId,
        endpoint: pushSubscriptions.endpoint,
        p256dhKey: pushSubscriptions.p256dhKey,
        authKey: pushSubscriptions.authKey,
        locale: users.locale,
      })
      .from(pushSubscriptions)
      .leftJoin(users, eq(users.id, pushSubscriptions.ownerUserId))
      .where(
        userIds && userIds.length > 0
          ? and(inArray(pushSubscriptions.ownerUserId, userIds), isNull(pushSubscriptions.deletedAt))
          : isNull(pushSubscriptions.deletedAt),
      )
    if (subs.length === 0) return

    await Promise.all(
      subs.map(async (sub) => {
        try {
          const base = payloadFor(payload, sub.locale)
          const wire =
            base.e2e && sub.ownerUserId
              ? { ...base, e2e: { ...base.e2e, userId: sub.ownerUserId } }
              : { title: base.title, body: base.body, url: base.url, tag: base.tag, call: base.call }
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dhKey, auth: sub.authKey },
            },
            JSON.stringify(wire),
          )
          const tag = base.tag
          if (tag && sub.ownerUserId) shownTags.set(shownKey(sub.ownerUserId, tag), Date.now())
        } catch (err) {
          const statusCode = (err as { statusCode?: number }).statusCode
          if (statusCode === 404 || statusCode === 410) {
            // Subscripție expirată/revocată de browser — self-cleaning, nu se acumulează gunoi.
            await db
              .update(pushSubscriptions)
              .set({ deletedAt: new Date() })
              .where(eq(pushSubscriptions.id, sub.id))
          } else {
            console.error(`[push] trimitere eșuată pt. subscripția ${sub.id}: ${String(err)}`)
          }
        }
      }),
    )
  } catch (err) {
    // Failure izolat — notifyPush nu blochează niciodată fluxul principal care-l apelează.
    console.error(`[push] notifyPush('${eventType}') eșuat: ${String(err)}`)
  }
}

// The tags a person has been shown on the web and not yet read, so a "close" push goes out only
// when there is something to close. Chrome asks every push to show a notification
// (userVisibleOnly); a push that closes nothing spends its small allowance of silent pushes and,
// once that is gone, Chrome shows a generic notification of its own. In memory: after a restart
// a notification shown before it simply stays until clicked, as it did before.
const SHOWN_TTL_MS = 7 * 24 * 60 * 60 * 1000
const shownTags = new Map<string, number>()
// Same idea for the APK: FCM throttles high-priority data messages that lead to nothing visible.
const shownOnAndroid = new Map<string, number>()
const shownKey = (userId: string, tag: string) => `${userId}\u0000${tag}`

function takeShown(shown: Map<string, number>, key: string): boolean {
  const shownAt = shown.get(key)
  shown.delete(key)
  return shownAt !== undefined && Date.now() - shownAt <= SHOWN_TTL_MS
}

/**
 * The person has read what a notification was about (a conversation, an email thread) on some
 * device: close it on their other browsers and phones. Never throws.
 */
export async function closePushNotification(userId: string, tag: string): Promise<void> {
  const key = shownKey(userId, tag)
  await Promise.all([
    takeShown(shownTags, key) ? closeOnWeb(userId, tag) : undefined,
    takeShown(shownOnAndroid, key) ? closeOnAndroid(userId, tag) : undefined,
  ])
}

async function closeOnWeb(userId: string, tag: string): Promise<void> {
  try {
    if (!ensureVapid()) return
    const subs = await db
      .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, p256dhKey: pushSubscriptions.p256dhKey, authKey: pushSubscriptions.authKey })
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.ownerUserId, userId), isNull(pushSubscriptions.deletedAt)))
    for (const sub of subs) {
      await webpush
        .sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dhKey, auth: sub.authKey } }, JSON.stringify({ type: 'close', tag }))
        .catch((err: unknown) => console.error(`[push] close for subscription ${sub.id} failed: ${String(err)}`))
    }
  } catch (err) {
    console.error(`[push] close '${tag}' failed: ${String(err)}`)
  }
}

/**
 * Trimite o notificare de test tuturor subscripțiilor active — ignoră preferințele
 * (buton explicit "Trimite test" în Settings, nu un eveniment real).
 */
export async function sendTestPush(ownerUserId: string): Promise<{ sent: number; failed: number }> {
  if (!ensureVapid()) throw httpError(503, 'PUSH_NOT_CONFIGURED').causedBy('VAPID keys missing')

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(and(isNull(pushSubscriptions.deletedAt), eq(pushSubscriptions.ownerUserId, ownerUserId)))
  const body = JSON.stringify({ title: tr('push.test.title'), body: tr('push.test.body') } satisfies PushPayload)

  let sent = 0
  let failed = 0
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dhKey, auth: sub.authKey } }, body)
        sent++
      } catch (err) {
        failed++
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          await db.update(pushSubscriptions).set({ deletedAt: new Date() }).where(eq(pushSubscriptions.id, sub.id))
        } else {
          console.error(`[push] test eșuat pt. subscripția ${sub.id}: ${String(err)}`)
        }
      }
    }),
  )
  return { sent, failed }
}

// ── FCM — canalul nativ al APK-ului Capacitor (PLAN.md Contract C) ────────────
// Web-push nu are prin ce ajunge în WebView (fără service worker), deci APK-ul primește
// notificările prin Firebase Cloud Messaging. Același notifyPush() face fan-out pe ambele
// canale, filtrate pe aceleași preferințe — apelanții existenti nu se schimbă deloc.

// Overridable în teste (vi.mock pe firebase-admin/messaging e greu din cauza init-ului global).
export type FcmSender = (tokens: string[], payload: PushPayload) => Promise<string[]>
export type FcmCloser = (tokens: string[], tag: string) => Promise<string[]>
export type FcmCallSender = (tokens: string[], payload: IncomingCallPayload) => Promise<string[]>
let fcmSender: FcmSender | null = null
let fcmCloser: FcmCloser | null = null
let fcmCallSender: FcmCallSender | null = null

/** Test-only — injectează un sender fals și întoarce cel real la restore. */
export function setFcmSenderForTests(sender: FcmSender | null): void {
  fcmSender = sender
}

export function setFcmCloserForTests(closer: FcmCloser | null): void {
  fcmCloser = closer
}

export function setFcmCallSenderForTests(sender: FcmCallSender | null): void {
  fcmCallSender = sender
}

// Self-cleaning, like 404/410 from web-push.
function staleFcmTokens(tokens: string[], responses: { success: boolean; error?: { code?: string } }[]): string[] {
  return responses.flatMap((r, i) => {
    if (r.success) return []
    const code = String(r.error?.code ?? '')
    return code.includes('registration-token-not-registered') || code.includes('invalid-registration-token') || code.includes('mismatched-credential')
      ? [tokens[i]!]
      : []
  })
}

async function getFcmSender(): Promise<FcmSender | null> {
  if (fcmSender) return fcmSender
  if (!config.firebase.serviceAccountJson) return null // neconfigurat — no-op, ca VAPID lipsă
  try {
    // Import modular (`firebase-admin/messaging`) — trage doar messaging + auth, nu tot SDK-ul.
    const [{ cert, initializeApp, getApps }, { getMessaging }] = await Promise.all([
      import('firebase-admin/app'),
      import('firebase-admin/messaging'),
    ])
    if (getApps().length === 0) {
      initializeApp({ credential: cert(JSON.parse(config.firebase.serviceAccountJson)) })
    }
    const messaging = getMessaging()
    fcmSender = async (tokens, payload) => {
      if (tokens.length === 0) return []
      const res = await messaging.sendEachForMulticast({
        tokens,
        notification: { title: payload.title, body: payload.body },
        data: { url: payload.url ?? '' },
        android: { priority: 'high', notification: payload.tag ? { tag: payload.tag } : undefined },
      })
      return staleFcmTokens(tokens, res.responses)
    }
    // Data only: the APK's messaging service handles it even when the app is closed. APKs older
    // than 1.5 receive it and ignore it.
    fcmCloser = async (tokens, tag) => {
      if (tokens.length === 0) return []
      const res = await messaging.sendEachForMulticast({ tokens, data: { type: 'close', tag }, android: { priority: 'high' } })
      return staleFcmTokens(tokens, res.responses)
    }
    // Data only, so the APK's messaging service builds the call screen itself, also when the app
    // is closed. The TTL matches the ring: a call delivered later than that has stopped ringing.
    fcmCallSender = async (tokens, payload) => {
      if (tokens.length === 0) return []
      const res = await messaging.sendEachForMulticast({
        tokens,
        data: {
          type: 'call',
          callId: payload.call.id,
          kind: payload.call.kind,
          tag: payload.tag,
          title: payload.title,
          body: payload.body,
          url: payload.url ?? '',
          answer: payload.call.answer,
          decline: payload.call.decline,
        },
        android: { priority: 'high', ttl: CALL_RING_MS },
      })
      return staleFcmTokens(tokens, res.responses)
    }
    return fcmSender
  } catch (err) {
    console.error(`[push] inițializare FCM eșuată: ${String(err)}`)
    return null
  }
}

async function closeOnAndroid(userId: string, tag: string): Promise<void> {
  try {
    if (!fcmCloser) await getFcmSender()
    if (!fcmCloser) return
    const rows = await db
      .select({ token: deviceTokens.token })
      .from(deviceTokens)
      .where(and(eq(deviceTokens.ownerUserId, userId), isNull(deviceTokens.deletedAt)))
    const stale = await fcmCloser(rows.map((row) => row.token), tag)
    for (const token of stale) await db.delete(deviceTokens).where(eq(deviceTokens.token, token))
  } catch (err) {
    console.error(`[push] FCM close '${tag}' failed: ${String(err)}`)
  }
}

async function notifyFcm(eventType: PushEventType, payload: PushContent, userIds?: string[]): Promise<void> {
  try {
    const prefs = await getPushPreferences()
    if (!prefs[eventType]) return
    const sender = await getFcmSender()
    if (!sender) return
    const rows = await db
      .select({ token: deviceTokens.token, locale: users.locale, ownerUserId: deviceTokens.ownerUserId })
      .from(deviceTokens)
      .leftJoin(users, eq(users.id, deviceTokens.ownerUserId))
      .where(
        userIds && userIds.length > 0
          ? and(inArray(deviceTokens.ownerUserId, userIds), isNull(deviceTokens.deletedAt))
          : isNull(deviceTokens.deletedAt),
      )
    // One multicast per language among the devices.
    const byLocale = new Map<Locale | null, string[]>()
    for (const row of rows) byLocale.set(row.locale, [...(byLocale.get(row.locale) ?? []), row.token])
    // No device registered: the sender is still called once, with nothing to send to, as before.
    if (rows.length === 0) byLocale.set(null, [])
    for (const [locale, tokens] of byLocale) {
      const content = payloadFor(payload, locale)
      const invalid = await sender(tokens, content)
      for (const token of invalid) {
        await db.delete(deviceTokens).where(eq(deviceTokens.token, token))
      }
      if (!content.tag) continue
      for (const row of rows) {
        if (row.ownerUserId && row.locale === locale && !invalid.includes(row.token)) {
          shownOnAndroid.set(shownKey(row.ownerUserId, content.tag), Date.now())
        }
      }
    }
  } catch (err) {
    console.error(`[push] FCM '${eventType}' eșuat: ${String(err)}`)
  }
}

export const CALL_RING_MS = 45_000

export type IncomingCallPayload = PushPayload & { tag: string; call: NonNullable<PushPayload['call']> }

/**
 * An incoming call rings like a phone call: every phone with the call screen (APK 1.6+) gets it,
 * also when the person has the app open on another device, and answering or declining anywhere
 * closes it everywhere (closePushNotification on the call tag). Browsers and older APKs get the
 * plain notification, only when the person is not in the app. Never throws.
 */
export async function notifyIncomingCallPush(
  content: (locale: Locale) => IncomingCallPayload,
  recipients: string[],
  offline: string[],
): Promise<void> {
  if (recipients.length === 0) return
  try {
    const prefs = await getPushPreferences()
    if (!prefs.mesaje) return
    // An empty list would mean everyone subscribed.
    if (offline.length > 0) await notifyWebPush('mesaje', content, offline)

    const sender = await getFcmSender()
    if (!sender) return
    const rows = await db
      .select({ token: deviceTokens.token, locale: users.locale, ownerUserId: deviceTokens.ownerUserId, callUi: deviceTokens.callUi })
      .from(deviceTokens)
      .leftJoin(users, eq(users.id, deviceTokens.ownerUserId))
      .where(and(inArray(deviceTokens.ownerUserId, recipients), isNull(deviceTokens.deletedAt)))

    const ringing = rows.filter((row) => row.callUi)
    const plain = rows.filter((row) => !row.callUi && row.ownerUserId !== null && offline.includes(row.ownerUserId))
    const groups: [typeof rows, FcmSender | FcmCallSender | null][] = [
      [ringing, fcmCallSender],
      [plain, sender],
    ]
    for (const [group, send] of groups) {
      if (!send || group.length === 0) continue
      const byLocale = new Map<Locale | null, typeof rows>()
      for (const row of group) byLocale.set(row.locale, [...(byLocale.get(row.locale) ?? []), row])
      for (const [locale, localeRows] of byLocale) {
        const payload = content(locale ?? config.defaultLocale)
        const tokens = localeRows.map((row) => row.token)
        const invalid = await send(tokens, payload)
        for (const token of invalid) await db.delete(deviceTokens).where(eq(deviceTokens.token, token))
        for (const row of localeRows) {
          if (row.ownerUserId && !invalid.includes(row.token)) shownOnAndroid.set(shownKey(row.ownerUserId, payload.tag), Date.now())
        }
      }
    }
  } catch (err) {
    console.error(`[push] incoming call push failed: ${String(err)}`)
  }
}

export async function registerDeviceToken(token: string, ownerUserId?: string | null, callUi = false): Promise<void> {
  await db
    .insert(deviceTokens)
    .values({ token, ownerUserId: ownerUserId ?? null, callUi })
    .onConflictDoUpdate({
      target: deviceTokens.token,
      // The phone now belongs to whoever logged in last on it, and runs the APK it reports now.
      set: { ownerUserId: ownerUserId ?? null, callUi, deletedAt: null, lastSeenAt: new Date(), updatedAt: new Date() },
    })
}

export async function deleteDeviceToken(token: string, ownerUserId?: string | null): Promise<void> {
  await db
    .update(deviceTokens)
    .set({ deletedAt: new Date() })
    .where(
      ownerUserId ? and(eq(deviceTokens.token, token), eq(deviceTokens.ownerUserId, ownerUserId)) : eq(deviceTokens.token, token),
    )
}
