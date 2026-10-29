import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { api } from './api'

// Canalul nativ FCM al APK-ului (Contract C) — web-push-ul browserelor trăiește în SW,
// WebView nu are prin ce să-l primească. Token-ul se înregistrează la login și se șterge
// la logout; notificările ajung pe ambele canale din backend (notifyPush fan-out).

const TOKEN_KEY = 'fcm-device-token'

export function isPushNativeAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('PushNotifications')
}

export async function registerNativeDeviceToken(): Promise<void> {
  if (!isPushNativeAvailable()) return

  const { PushNotifications: Push } = await import('@capacitor/push-notifications')

  await new Promise<void>((resolve) => {
    void Push.requestPermissions().then((result) => {
      if (result.receive !== 'granted') {
        resolve()
        return
      }
      const timeout = setTimeout(resolve, 15_000)
      Push.addListener('registration', (token) => {
        clearTimeout(timeout)
        localStorage.setItem(TOKEN_KEY, token.value)
        void api
          .post('/api/push/device', { token: token.value })
          .catch(() => {})
          .finally(resolve)
      })
      Push.addListener('registrationError', () => {
        clearTimeout(timeout)
        resolve()
      })
      Push.register()
    })
  })
}

/** Calls `open` with the in-app path of a tapped notification. Returns the cleanup. */
export function onNativeNotificationTap(open: (path: string) => void): () => void {
  if (!isPushNativeAvailable()) return () => {}
  const listener = PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const url: unknown = action.notification.data?.url
    if (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')) open(url)
  })
  return () => {
    void listener.then((handle) => handle.remove())
  }
}

export async function unregisterNativeDeviceToken(): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY)
  localStorage.removeItem(TOKEN_KEY)
  if (!token || !isPushNativeAvailable()) return
  await api.delete('/api/push/device', { token }).catch(() => {})
}

/**
 * Șterge din bara de notificări Android orice notificare cu tag-ul dat (2026-09-03, Stefan:
 * deschidea emailul în aplicație, notificarea rămânea în bară, trebuia ștearsă manual). Tag-ul
 * vine din backend (shared/lib/push.ts, `thread-<id>`) — vezi apelantul din MailboxView.tsx,
 * declanșat la deschiderea unui thread. No-op pe web/dacă native indisponibil — `tag` există
 * doar pe Android (PushNotificationSchema.tag).
 */
export async function dismissDeliveredNotificationsByTag(tag: string): Promise<void> {
  if (!isPushNativeAvailable()) return
  try {
    const { notifications } = await PushNotifications.getDeliveredNotifications()
    const toRemove = notifications.filter((n) => n.tag === tag)
    if (toRemove.length > 0) await PushNotifications.removeDeliveredNotifications({ notifications: toRemove })
  } catch {
    // Best-effort — o notificare rămasă în bară nu trebuie să întrerupă nimic din citirea emailului.
  }
}

export { PushNotifications }
