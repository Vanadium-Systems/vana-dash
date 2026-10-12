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

  event.waitUntil(
    self.registration.showNotification(payload.title || 'VanaDash', {
      body: payload.body || '',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
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
