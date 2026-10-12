import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api, ApiError } from '@/shared/lib/api'
import { unregisterNativeDeviceToken } from '@/shared/lib/native-push'
import { ME_QUERY_KEY, useMe } from '@/shared/hooks/use-me'
import type { SessionPayload } from '@/shared/lib/types'

// Setat la orice 200 pe /api/auth/me sau login reușit, șters explicit doar la un 401 REAL
// sau logout — NU la o eroare de rețea. Bug 1a (offline → redirect greșit la /login): un
// TypeError de fetch (offline, cache-miss SW) nu înseamnă "delogat", doar "nu pot verifica
// acum" — fără acest flag, orice eroare (rețea inclusivă) era tratată identic cu un 401 real.
const WAS_AUTHENTICATED_KEY = 'wasAuthenticated'

/**
 * Starea sesiunii pentru shell: `isAuthenticated` + `session`. Nu mai interogăm `/me` a doua
 * oară — `useMe()` are deja query-ul, cu același cache.
 */
export function useAuth() {
  const { session, isPending, error } = useMe()

  const isRealUnauthorized = error instanceof ApiError && error.status === 401

  useEffect(() => {
    if (session) localStorage.setItem(WAS_AUTHENTICATED_KEY, '1')
  }, [session])
  useEffect(() => {
    if (isRealUnauthorized) localStorage.removeItem(WAS_AUTHENTICATED_KEY)
  }, [isRealUnauthorized])

  // Eroare care NU e un 401 explicit (rețea offline, SW cache-miss, 5xx tranzitoriu) — dacă
  // am fost autentificați ultima dată cu succes, păstrăm starea (offline banner, nu login).
  const isOfflineWithKnownAuth = Boolean(error) && !isRealUnauthorized && localStorage.getItem(WAS_AUTHENTICATED_KEY) === '1'

  return {
    user: session?.user ?? null,
    session,
    isPending,
    isAuthenticated: Boolean(session) || isOfflineWithKnownAuth,
  }
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { email: string; password: string }) => api.post<SessionPayload>('/api/auth/login', body),
    onSuccess: async (session) => {
      queryClient.setQueryData(ME_QUERY_KEY, session)
      localStorage.setItem(WAS_AUTHENTICATED_KEY, '1')
      // Un login reușit schimbă sesiunea — dacă am lăsat cache-ul SW pe /api/auth/me din
      // urmă (ex: încă ținea minte un 401 dintr-o sesiune expirată), un refetch imediat l-ar
      // fi servit stale în loc de noul cookie valid. Nu așteptăm cele 5 min de maxAgeSeconds.
      if ('caches' in window) await caches.delete('auth-cache')
    },
  })
}

// Curățate explicit la logout — telefonul e al lui Stefan, risc redus, dar un telefon
// pierdut/împrumutat nu ar trebui să lase mailuri vechi accesibile după logout.
const OFFLINE_CACHE_NAMES = ['email-cache', 'calendar-cache', 'pricing-cache', 'auth-cache']

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<void>('/api/auth/logout'),
    onSuccess: async () => {
      // Token-ul FCM al APK-ului nu mai primește notificări pe acest device (Contract C).
      await unregisterNativeDeviceToken().catch(() => {})
      queryClient.clear()
      localStorage.removeItem(WAS_AUTHENTICATED_KEY)
      if ('caches' in window) {
        await Promise.all(OFFLINE_CACHE_NAMES.map((name) => caches.delete(name)))
      }
      window.location.href = '/login'
    },
  })
}
