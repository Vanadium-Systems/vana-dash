import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React, { useSyncExternalStore } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import { ErrorBoundary } from '@/shared/components/ErrorBoundary'
import { ReloadOnNavigate, watchForUpdates } from '@/shared/lib/app-update'
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

// In the Capacitor shell the service worker is off: the shell is already the installed app,
// and stale caches here caused the bugs fixed on 2026-08-18. Anything left registered (e.g. from
// the spike build) is removed at boot so the page always loads live.
if ('serviceWorker' in navigator) {
  if (isNative) {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((reg) => reg.unregister()))
    if ('caches' in window) caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)))
  } else {
    watchForUpdates()
  }
}

// On a phone toasts sit at the bottom, by the thumb and above the bottom nav (MA12).
const phoneQuery = window.matchMedia('(max-width: 767px)')
function AppToaster() {
  const phone = useSyncExternalStore(
    (onChange) => {
      phoneQuery.addEventListener('change', onChange)
      return () => phoneQuery.removeEventListener('change', onChange)
    },
    () => phoneQuery.matches,
  )
  return (
    <Toaster
      richColors
      position={phone ? 'bottom-center' : 'top-right'}
      offset={phone ? 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' : undefined}
      toastOptions={{ style: { fontFamily: 'Inter, system-ui, sans-serif' } }}
    />
  )
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
            <AppToaster />
            {!isNative && <ReloadOnNavigate />}
          </BrowserRouter>
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  )
}

void start()
