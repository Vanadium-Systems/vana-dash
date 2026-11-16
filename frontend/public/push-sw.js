// Handler push + notificationclick — importat via workbox.importScripts în vite.config.ts.
// Fișier static (NU trece prin build Vite/TS) — rulează în contextul Service Worker-ului
// generat de vite-plugin-pwa (generateSW), fără să atingă strategia de cache existentă.
/* eslint-disable no-undef */

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
    self.registration.showNotification(payload.title || 'VanaDash', {
      body: payload.body || '',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      // Same tag = replaces the previous notification of that conversation or thread.
      tag: payload.tag || undefined,
      data: { url: payload.url || '/' },
    }),
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
