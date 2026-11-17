// Handler push + notificationclick — importat via workbox.importScripts în vite.config.ts.
// Fișier static (NU trece prin build Vite/TS) — rulează în contextul Service Worker-ului
// generat de vite-plugin-pwa (generateSW), fără să atingă strategia de cache existentă.
/* eslint-disable no-undef */

try {
  importScripts('push-decrypt.js')
} catch {
  // Decryption helper missing (e.g. before first build); falls back to payload.body.
}

async function resolveBody(payload) {
  const fallback = payload.body || ''
  if (!payload.e2e || !self.VanaPushDecrypt || !self.VanaPushDecrypt.decryptPush) return fallback
  try {
    const out = await Promise.race([
      self.VanaPushDecrypt.decryptPush(payload.e2e),
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ])
    if (!out) return fallback
    const text = (out.body || '').trim() || (out.hasAttachments ? '📎' : '')
    if (!text) return fallback
    return payload.e2e.kind === 'group' && payload.e2e.byline ? `${payload.e2e.byline}: ${text}` : text
  } catch {
    return fallback
  }
}

self.addEventListener('push', (event) => {
  let payload = { title: 'VanaDash', body: '' }
  try {
    if (event.data) payload = event.data.json()
  } catch {
    payload = { title: 'VanaDash', body: event.data ? event.data.text() : '' }
  }

  // Read on another device: close what is still shown about it here.
  if (payload.type === 'close') {
    event.waitUntil(
      self.registration.getNotifications({ tag: payload.tag }).then((shown) => shown.forEach((n) => n.close())),
    )
    return
  }

  event.waitUntil(
    resolveBody(payload).then((body) =>
      self.registration.showNotification(payload.title || 'VanaDash', {
        body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        // Same tag = replaces the previous notification of that conversation or thread.
        tag: payload.tag || undefined,
        data: { url: payload.url || '/' },
      }),
    ),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        const clientUrl = new URL(client.url)
        if (clientUrl.origin === self.location.origin && 'focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
