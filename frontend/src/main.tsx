import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import { ErrorBoundary } from '@/shared/components/ErrorBoundary'
import { initI18n } from '@/shared/lib/i18n'
import { isNative } from '@/shared/lib/native'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    // 30s — navigarea între pagini nu mai re-fetch-uiește tot din React Query (default 0ms);
    // mutațiile fac deja invalidateQueries explicit, deci datele proprii ale lui Stefan rămân
    // proaspete. Hook-urile cu poll propriu (staleTime mai scurt sau nespecificat) suprascriu.
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
})

// Browserul verifică singur update-uri ale SW-ului doar la navigare + o dată la ~24h în
// fundal — insuficient dacă tab-ul rămâne deschis zile la rând (sesiunea de login ține 7
// zile). Forțăm o verificare orară; skipWaiting+clientsClaim (vite.config.ts) + reload-ul
// automat injectat de vite-plugin-pwa (registerType: 'autoUpdate') fac restul, fără să mai
// fie nevoie de închiderea completă a browserului pentru un deploy nou.
//
// Pe nativ SW-ul e dezactivat complet: shell-ul Capacitor e deja "aplicația instalată" și
// cache-urile stale de aici au produs exact clasa de bug-uri reparată în 2026-08-18. La boot
// ștergem ce a rămas înregistrat (ex. din build-ul de spike), ca pagina să meargă mereu live.
if ('serviceWorker' in navigator) {
  if (isNative) {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((reg) => reg.unregister()))
    if ('caches' in window) caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)))
  } else {
    const SW_UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000
    navigator.serviceWorker.ready.then((registration) => {
      setInterval(() => registration.update(), SW_UPDATE_CHECK_INTERVAL_MS)
    })
  }
}

// The language has to be known before any module that builds labels is evaluated, so the app
// itself is imported only after the texts are loaded.
async function start() {
  await initI18n()
  const { App } = await import('./App')

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
            <Toaster
              richColors
              position="top-right"
              toastOptions={{ style: { fontFamily: 'Inter, system-ui, sans-serif' } }}
            />
          </BrowserRouter>
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  )
}

void start()
