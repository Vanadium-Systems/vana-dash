import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import webpush from 'web-push'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { dashboardConfig, deviceTokens, pushSubscriptions } from '../db/schema/index.js'

// Wrapper unic pt. Web Push (PLAN.md Sprint 2) — fire-and-forget, niciun `await` blocant pe
// fluxul principal la punctele de integrare. Cheia privată VAPID nu ajunge NICIODATĂ în vreun
// response — doar cea publică, expusă prin GET /api/push/vapid-public-key.

export type PushEventType = 'alerts' | 'email' | 'invoiceStatus' | 'calendarReminder' | 'paymentMatch' | 'mesaje' | 'suport'

export interface PushPreferences {
  alerts: boolean
  email: boolean
  invoiceStatus: boolean
  calendarReminder: boolean
  paymentMatch: boolean
  mesaje: boolean
  suport: boolean
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
      target: dashboardConfig.key,
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
export async function notifyPush(
  eventType: PushEventType,
  payload: PushPayload,
  userIds?: string[],
): Promise<void> {
  await Promise.all([notifyWebPush(eventType, payload, userIds), notifyFcm(eventType, payload, userIds)])
}

async function notifyWebPush(eventType: PushEventType, payload: PushPayload, userIds?: string[]): Promise<void> {
  try {
    if (!ensureVapid()) return // VAPID neconfigurat — no-op silențios (pattern RESEND_API_KEY)

    const prefs = await getPushPreferences()
    if (!prefs[eventType]) return

    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(
        userIds && userIds.length > 0
          ? and(inArray(pushSubscriptions.ownerUserId, userIds), isNull(pushSubscriptions.deletedAt))
          : isNull(pushSubscriptions.deletedAt),
      )
    if (subs.length === 0) return

    const body = JSON.stringify(payload)
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dhKey, auth: sub.authKey },
            },
            body,
          )
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

/**
 * Trimite o notificare de test tuturor subscripțiilor active — ignoră preferințele
 * (buton explicit "Trimite test" în Settings, nu un eveniment real).
 */
export async function sendTestPush(): Promise<{ sent: number; failed: number }> {
  if (!ensureVapid()) throw new Error('VAPID neconfigurat — setează VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY în .env')

  const subs = await db.select().from(pushSubscriptions).where(isNull(pushSubscriptions.deletedAt))
  const body = JSON.stringify({ title: 'Test vana-dash', body: 'Notificările push funcționează.' } satisfies PushPayload)

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
let fcmSender: FcmSender | null = null

/** Test-only — injectează un sender fals și întoarce cel real la restore. */
export function setFcmSenderForTests(sender: FcmSender | null): void {
  fcmSender = sender
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
      return res.responses.flatMap((r, i) => {
        if (r.success) return []
        // Token invalid/unregistered (messaging/registration-token-not-registered etc.) —
        // self-cleaning, identic cu 404/410 de la web-push.
        const code = String(r.error?.code ?? '')
        return code.includes('registration-token-not-registered') || code.includes('invalid-registration-token') || code.includes('mismatched-credential')
          ? [tokens[i]!]
          : []
      })
    }
    return fcmSender
  } catch (err) {
    console.error(`[push] inițializare FCM eșuată: ${String(err)}`)
    return null
  }
}

async function notifyFcm(eventType: PushEventType, payload: PushPayload, userIds?: string[]): Promise<void> {
  try {
    const prefs = await getPushPreferences()
    if (!prefs[eventType]) return
    const sender = await getFcmSender()
    if (!sender) return
    const tokens = (
      await db
        .select({ token: deviceTokens.token })
        .from(deviceTokens)
        .where(
          userIds && userIds.length > 0
            ? and(inArray(deviceTokens.ownerUserId, userIds), isNull(deviceTokens.deletedAt))
            : isNull(deviceTokens.deletedAt),
        )
    ).map((r) => r.token)
    const invalid = await sender(tokens, payload)
    for (const token of invalid) {
      await db.delete(deviceTokens).where(eq(deviceTokens.token, token))
    }
  } catch (err) {
    console.error(`[push] FCM '${eventType}' eșuat: ${String(err)}`)
  }
}

export async function registerDeviceToken(token: string, ownerUserId?: string | null): Promise<void> {
  await db
    .insert(deviceTokens)
    .values({ token, ownerUserId: ownerUserId ?? null })
    .onConflictDoUpdate({
      target: deviceTokens.token,
      set: { deletedAt: null, lastSeenAt: new Date(), updatedAt: new Date() },
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
