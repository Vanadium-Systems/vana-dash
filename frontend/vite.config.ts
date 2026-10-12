import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon.svg', 'favicon.png'],
      manifest: {
        name: 'VanaDash',
        short_name: 'VanaDash',
        description: 'Vanadium Systems — dashboard intern',
        lang: 'ro',
        id: '/',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        categories: ['business', 'finance', 'productivity'],
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Overview', url: '/' },
          { name: 'Email', url: '/email' },
          { name: 'Calendar', url: '/calendar' },
          { name: 'Arhivă', url: '/archive' },
        ],
        screenshots: [
          { src: '/screenshots/overview-narrow.png', sizes: '412x915', type: 'image/png', form_factor: 'narrow' },
          { src: '/screenshots/email-narrow.png', sizes: '412x915', type: 'image/png', form_factor: 'narrow' },
        ],
      },
      workbox: {
        // clientsClaim + skipWaiting — SW-ul nou preia controlul imediat, fără să aștepte
        // închiderea tuturor tab-urilor/instanțelor PWA. Fără asta, un tab lăsat deschis zile
        // la rând (sesiunea de login ține 7 zile) rămâne blocat pe bundle-ul vechi — hard
        // refresh nu ocolește un service worker activ, doar cache-ul HTTP normal. Găsit live
        // 2026-07-28: singurul fix găsit de Stefan a fost închiderea completă a browserului.
        clientsClaim: true,
        skipWaiting: true,
        // Convertorul HEIC din Mesaje (~3 MB) se încarcă doar la prima poză HEIC; în precache
        // l-ar descărca fiecare instalare, iar peste 2 MB build-ul pică.
        globIgnores: ['**/heic-to-*.js'],
        // Dashboard financiar — cifre stale dintr-un cache ar fi mai rău decât fără PWA.
        // /vanadash.apk exclus din fallback — altfel navigarea către APK primea index.html
        // (redirect la / în router), iar descărcarea directă din browsere era imposibilă.
        navigateFallbackDenylist: [/^\/api\//, /^\/vanadash\.apk$/],
        // Web Push (Sprint 2) — importă handler-ul push/notificationclick STATIC din public/,
        // fără să rescriem strategia generateSW existentă (injectManifest ar fi însemnat
        // reimplementarea manuală a runtimeCaching-ului de mai jos, calibrat cu bug-uri reale
        // găsite prin testare live — vezi PLAN.md Sprint 2).
        importScripts: ['push-sw.js'],
        runtimeCaching: [
          // Email/Calendar/Pricing — offline explicit cerut de Stefan, "ultima versiune
          // cunoscută" ca la Gmail. Trebuie ÎNAINTEA catch-all-ului NetworkOnly de mai jos —
          // workbox evaluează array-ul în ordine, primul match câștigă. method:'GET' explicit
          // (nu doar regex pe path) — critic pt. Calendar, unde POST și GET /api/calendar/events
          // au același path.
          // GET /api/auth/me — fără el, RequireAuth (App.tsx) redirectează la /login la orice
          // cold-start offline, blocând accesul la cache-urile de mai jos înainte să apuce să
          // fie citite. maxAgeSeconds mărit la 7 zile (era 5 min, 2026-07-28) — Workbox tratează
          // o intrare expirată ca miss TOTAL, nu ca "stale dar utilizabilă", deci fereastra de
          // 5 min expira aproape mereu în timpul unei nave/tunel/avion reale, forțând fetch-ul
          // să eșueze necapturat → tratat identic cu un 401 (bug 1a). Cache-ul de-aici alimentează
          // DOAR gate-ul UI client-side — orice request real de date tot trece prin JWT-ul din
          // cookie, verificat server-side, neafectat de TTL. Riscul din 2026-07-28 (cookie expirat
          // "ținut minte" ca valid) e rezolvat acum la sursă în use-auth.ts: DOAR un 401 explicit
          // golește starea de auth; o eroare de rețea/cache-miss păstrează ultima stare cunoscută
          // (flag `wasAuthenticated`), nu se mai bazează pe cât de proaspăt e cache-ul SW. Invalidat
          // explicit și la login/logout (use-auth.ts) ca strat suplimentar.
          {
            urlPattern: ({ url, request }: { url: URL; request: Request }) =>
              request.method === 'GET' && url.pathname === '/api/auth/me',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'auth-cache', expiration: { maxEntries: 1, maxAgeSeconds: 7 * 86400 } },
          },
          // NetworkFirst cu timeout scurt (2026-08-25, Contractul D): după o mutație, React
          // Query refetch-uia corect, dar SW-ul răspundea INSTANT din cache cu varianta veche
          // (StaleWhileRevalidate) — UI-ul arăta date vechi până la al doilea fetch, iar asta
          // a produs 2 patch-uri ad-hoc acum eliminate (caches.delete din EventFormDialog,
          // excepția din ConfigPretTab). Online = mereu proaspăt; offline/timeout = cade pe
          // cache (cerința de offline rămâne intactă).
          {
            urlPattern: ({ url, request }: { url: URL; request: Request }) =>
              request.method === 'GET' && /^\/api\/email\/(threads|unread-counts|labels)/.test(url.pathname),
            handler: 'NetworkFirst',
            options: { cacheName: 'email-cache', networkTimeoutSeconds: 3, expiration: { maxEntries: 100, maxAgeSeconds: 7 * 86400 } },
          },
          {
            urlPattern: ({ url, request }: { url: URL; request: Request }) =>
              request.method === 'GET' && url.pathname === '/api/calendar/events',
            handler: 'NetworkFirst',
            options: { cacheName: 'calendar-cache', networkTimeoutSeconds: 3, expiration: { maxEntries: 50, maxAgeSeconds: 7 * 86400 } },
          },
          {
            urlPattern: ({ url, request }: { url: URL; request: Request }) =>
              request.method === 'GET' && (url.pathname === '/api/pricing/config' || url.pathname === '/api/platforms'),
            handler: 'NetworkFirst',
            options: { cacheName: 'pricing-cache', networkTimeoutSeconds: 3, expiration: { maxEntries: 20, maxAgeSeconds: 7 * 86400 } },
          },
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5174,
    // Ascultă pe toate interfețele — necesar în containerul de dev (port publish)
    host: true,
    // Same-origin în dev: cookie-ul HttpOnly merge fără config de CORS/domain
    proxy: {
      '/api': { target: process.env.VITE_BACKEND_URL ?? 'http://localhost:3001', changeOrigin: true },
    },
  },
})
