import { useEffect } from 'react'
import { useMe } from '@/shared/hooks/use-me'
import { api, ApiError } from '@/shared/lib/api'
import type { EmailThread, Platform } from '@/shared/lib/types'

// Pornit din AppLayout (montat o singură dată per sesiune autentificată, la deschiderea
// aplicației + la fiecare revenire online) — încălzește cache-urile StaleWhileRevalidate
// (email/calendar/pricing, vite.config.ts) FĂRĂ ca Stefan să trebuiască să deschidă manual
// fiecare pagină/thread ca să le vadă offline (cerință explicită, 2026-07-22 — altfel un
// email necitit rămânea inaccesibil offline până era deschis o dată online).
//
// Un "cron" real (Periodic Background Sync) ar rula chiar cu aplicația închisă, dar Chrome
// decide singur frecvența reală (best-effort, nu garantat orar) — respins explicit în
// favoarea variantei de mai jos, predictibilă.
//
// Bounded — prima pagină de Inbox (max 50 thread-uri, ca implicit MailboxView), nu istoricul
// întreg de emailuri pe toate folderele; extinde aici dacă apare nevoia.
// Best-effort peste tot — offline la boot sau un endpoint temporar jos nu blochează nimic
// vizibil, doar nu apucă să (re)populeze cache-ul respectiv.

function startOfWeek(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay() // 0 = duminică
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  return d
}

async function prefetchAuth() {
  try {
    // useLogin (use-auth.ts) setează userul direct din răspunsul POST /api/auth/login,
    // FĂRĂ să facă vreodată un GET real către /api/auth/me — deci service workerul nu apucă
    // să-l cache-uiască (auth-cache, vite.config.ts) decât la un reload complet întâmplător.
    // Fără acest apel explicit, un cold-start offline (aplicația omorâtă de Android, nu doar
    // pusă în fundal) ar lovi din nou exact bug-ul "mă duce la login offline", chiar cu
    // auth-cache configurat. Apel redundant, dar ieftin — doar ca să treacă o dată prin rețea.
    await api.get('/api/auth/me')
  } catch {
    // best-effort
  }
}

async function prefetchEmail(enabled: boolean) {
  if (!enabled) return
  try {
    await Promise.all([api.get('/api/email/unread-counts'), api.get('/api/email/labels')])
    const { items } = await api.get<{ items: EmailThread[] }>('/api/email/threads?folder=inbox&limit=50&offset=0')
    // Secvențial, un thread pe rând — un Promise.all peste toate cele 50 trimitea un burst
    // care golea bucket-ul de rate-limit al backend-ului (vezi app.ts) și bloca temporar
    // restul dashboard-ului cu 429. Ne oprim imediat dacă tot lovim rate-limit-ul — a
    // continua în buclă n-ar face decât să țină bucket-ul golit mai mult.
    for (const t of items) {
      try {
        await api.get(`/api/email/threads/${t.id}`)
      } catch (err) {
        if (err instanceof ApiError && err.status === 429) break
      }
    }
  } catch {
    // best-effort
  }
}

async function prefetchCalendar(enabled: boolean) {
  if (!enabled) return
  try {
    const weekStart = startOfWeek(new Date())
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)
    await api.get(`/api/calendar/events?from=${weekStart.toISOString()}&to=${weekEnd.toISOString()}`)
  } catch {
    // best-effort
  }
}

async function prefetchPricing(enabled: boolean) {
  if (!enabled) return
  try {
    // Lista de platforme e „doar Vanadium" (`platforme.view`), deci fără ea nu știm pentru
    // ce id-uri să încălzim configul de prețuri — nu e o pierdere, ci o corectitudine.
    const platforms = await api.get<Platform[]>('/api/platforms')
    await Promise.all(platforms.map((p) => api.get(`/api/pricing/config?platformId=${p.id}`).catch(() => null)))
  } catch {
    // best-effort
  }
}

const PREFETCH_COOLDOWN_MS = 10 * 60 * 1000
let lastPrefetchAt = 0

export function useOfflinePrefetch(enabled: boolean) {
  // Găsit live 2026-08-18: cu o sesiune expirată, bucla secvențială din prefetchEmail (până
  // la 50 request-uri) rula la fiecare montare a AppLayout, golea bucket-ul de rate-limit
  // (429) și amplifica exact criza de auth pe care 401-urile ei ar fi trebuit s-o semnaleze.
  // can() (nu doar `enabled`/online) — fără sesiune validă n-are ce încălzi, iar fără
  // funcționalitate ar lovi doar 403-uri pe cache-uri pe care omul nu le va deschide.
  const { can } = useMe()
  const canPrefetch = can('email.view') || can('calendar.view') || can('clienti.view')
  useEffect(() => {
    if (!enabled || !canPrefetch) return
    // Cooldown la nivel de modul (nu per-montare): un blip scurt offline→online (schimbare
    // wifi/date, ieșire din sleep pe telefon) nu mai repornește tot burst-ul dacă ultima
    // rulare completă a fost recentă.
    const now = Date.now()
    if (now - lastPrefetchAt < PREFETCH_COOLDOWN_MS) return
    lastPrefetchAt = now
    void Promise.all([
      prefetchAuth(),
      prefetchEmail(can('email.view')),
      prefetchCalendar(can('calendar.view')),
      prefetchPricing(can('clienti.view') && can('platforme.view')),
    ])
  }, [enabled, canPrefetch])
}
