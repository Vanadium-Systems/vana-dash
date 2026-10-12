import { api } from './api'

// Web Push (PLAN.md Sprint 2) — cere permisiune, ia cheia VAPID publică, subscrie
// PushManager-ul din Service Worker-ul deja înregistrat de vite-plugin-pwa, POST la backend.

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64Safe)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function subscribeToPush(): Promise<void> {
  if (!isPushSupported()) throw new Error('Browserul acesta nu suportă notificări push')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Permisiune refuzată pt. notificări')

  const { publicKey } = await api.get<{ publicKey: string }>('/api/push/vapid-public-key')
  if (!publicKey) throw new Error('VAPID neconfigurat pe server — contactează administratorul')

  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  }

  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('Subscripție push invalidă (lipsesc cheile)')
  }

  await api.post('/api/push/subscribe', {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    deviceLabel: navigator.userAgent.includes('Android') ? 'Android' : navigator.platform || undefined,
  })
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return

  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  await api.delete('/api/push/subscribe', { endpoint })
}

export async function getPushPermissionState(): Promise<NotificationPermission | 'unsupported'> {
  if (!isPushSupported()) return 'unsupported'
  return Notification.permission
}

export async function isSubscribedToPush(): Promise<boolean> {
  if (!isPushSupported()) return false
  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  return subscription !== null
}
