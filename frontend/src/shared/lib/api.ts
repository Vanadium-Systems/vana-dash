// Fetch wrapper: same-origin (/api proxied în dev), cookie HttpOnly, 401 → login.
import { Directory, Filesystem } from '@capacitor/filesystem'
import { toast } from 'sonner'
import { getLocale, t } from '@/shared/lib/i18n'
import { BASE_CURRENCY } from '@/shared/lib/locale'
import { blobToBase64, isNative } from '@/shared/lib/native'
import type { MoneyMeta } from '@/shared/lib/types'
import { getTenantOverride } from './tenant-override'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Codul stabil din PLAN.md C2 (`FEATURE_FORBIDDEN`, `MAILBOX_FORBIDDEN`, …). */
    public code?: string,
    /** Corpul răspunsului, pentru codurile care vin cu detalii (`THREAD_REPLIED_MEANWHILE`). */
    public body?: unknown,
  ) {
    super(message)
  }
}

// Un 403 pe o funcționalitate înseamnă că rolul i-a fost schimbat sub om (serverul
// recalculează la fiecare request). Reîncărcăm `/me` o singură dată, ca nav-ul, tab-urile
// și butoanele să dispară fără reîncărcarea paginii — vezi PLAN.md C2 („efect la următorul
// request, fără delogare").
let refreshMeOnce: (() => Promise<unknown>) | null = null
export function onForbiddenRefreshMe(refresh: () => Promise<unknown>) {
  refreshMeOnce = refresh
}

interface ApiEnvelope<T> {
  success: boolean
  data: T
  /** Present on responses with totals: the currency the figures are in. */
  money?: MoneyMeta
  error?: string | { code?: string; message?: string; [key: string]: unknown }
}

// Găsit live 2026-08-18: un cookie mort declanșa 401 pe fiecare query autentificat activ pe
// pagină (poll-uri, prefetch offline) — fiecare, independent, făcea window.location.href =
// '/login', deci un reload complet per 401. Cache-ul SW 'auth-cache' (vite.config.ts,
// StaleWhileRevalidate, 7 zile) tot servea un /api/auth/me vechi cu succes la fiecare reload
// (revalidarea din fundal primea 401 real, dar workbox nu suprascrie cache-ul cu un răspuns
// eșuat), deci AppLayout se remonta din nou, lovea din nou rutele neautentificate, reload
// din nou — buclă fără ieșire, ecran înghețat. Ștergem cache-ul stale ÎNAINTE de reload, ca
// următorul /api/auth/me să lovească rețeaua real, plus un guard să nu mai reîncărcăm dacă
// suntem deja pe /login.
let redirectingToLogin = false
async function handleUnauthorized(): Promise<never> {
  if (!redirectingToLogin && window.location.pathname !== '/login') {
    redirectingToLogin = true
    if ('caches' in window) await caches.delete('auth-cache').catch(() => {})
    window.location.href = '/login'
  }
  throw new ApiError(401, 'Unauthorized')
}

/**
 * Mesajul pe care îl vede omul când o cerere pică. Rutele aplicației trimit `{ success: false,
 * error }` cu text scris pentru om, care trece neschimbat — inclusiv forma nouă, cu obiect
 * `{ code, message }` (acces, cutii de email). Restul (500 de la Fastify, validare zod,
 * rate limit, fără rețea) devine un mesaj care spune ce urmează; detaliul tehnic rămâne în
 * consolă, doar în dev. Singurul loc unde se decide asta, ca paginile să poată face
 * `toast.error(err.message)` fără să arate „Internal Server Error".
 */
function errorDetails(status: number, body: ApiEnvelope<unknown> | null): { message: string; code?: string } {
  const raw = body?.error
  if (body && body.success === false) {
    if (typeof raw === 'string' && raw) return { message: raw }
    if (raw && typeof raw === 'object' && raw.message) return { message: raw.message, code: raw.code }
    // Doar cod, fără text (`INVITE_EXPIRED`, `RESET_TOKEN_EXPIRED`): pagina decide ce arată
    // după cod. Pierdut, linkul de invitație deja folosit apărea ca „date invalide".
    if (raw && typeof raw === 'object' && raw.code) return { message: userMessage(status, body), code: raw.code }
  }
  return { message: userMessage(status, body) }
}

function userMessage(status: number, body: ApiEnvelope<unknown> | null): string {
  if (import.meta.env.DEV && body) console.warn(`[api] ${status}`, body)
  if (status === 429) return t('common:errors.api.tooManyRequests')
  if (status === 400 || status === 422) return t('common:errors.api.invalidData')
  if (status === 404) return t('common:errors.api.notFound')
  if (status >= 500) return t('common:errors.api.server')
  return t('common:errors.api.generic', { status })
}

async function requestEnvelope<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  // FormData (upload arhivă) — browserul setează singur Content-Type cu boundary-ul multipart,
  // nu-l suprascriem cu application/json.
  const isFormData = init?.body instanceof FormData
  const tenantOverride = getTenantOverride()
  const res = await fetch(path, {
    credentials: 'include',
    headers: {
      // Before login the server has no profile to read the language from.
      'X-Locale': getLocale(),
      ...(tenantOverride ? { 'X-Tenant-Id': tenantOverride.id } : {}),
      ...(init?.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
    },
    ...init,
  }).catch(() => {
    throw new ApiError(0, t('common:errors.api.network'))
  })

  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    return handleUnauthorized()
  }

  const body = (await res.json().catch(() => null)) as (ApiEnvelope<T> & { message?: string }) | null
  // Rutele fără răspuns (204: forgot-password, reset-password) nu trimit envelope.
  if (res.status === 204) return { success: true, data: undefined as T }
  if (!res.ok || !body?.success) {
    const { message, code } = errorDetails(res.status, body)
    // Rolul tocmai i-a fost schimbat: reîncărcăm `/me` ca interfața să se potrivească.
    if (res.status === 403 && code === 'FEATURE_FORBIDDEN') void refreshMeOnce?.()
    throw new ApiError(res.status, message, code, body)
  }
  return body
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await requestEnvelope<T>(path, init)).data
}

// Pt. rute binare (nu envelope-ul {success,data}). Citește Content-Disposition dacă serverul
// îl trimite, altfel cade pe `fallbackFileName` — folosit atât pt. descărcare reală pe disc
// (ArchivePage, Accounting → Primite), cât și pt. Web Share API (fișierul are nevoie de bytes
// reali în JS, nu doar un URL — vezi getBlob).
async function fetchBlob(path: string): Promise<{ blob: Blob; filename: string | null }> {
  const res = await fetch(path, { credentials: 'include' })
  if (res.status === 401) {
    return handleUnauthorized()
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiEnvelope<unknown> | null
    throw new ApiError(res.status, userMessage(res.status, body))
  }
  const disposition = res.headers.get('Content-Disposition')
  const match = disposition ? /filename="?([^";]+)"?/.exec(disposition) : null
  return { blob: await res.blob(), filename: match?.[1] ?? null }
}

async function downloadFile(path: string, fallbackFileName: string): Promise<void> {
  const { blob, filename } = await fetchBlob(path)
  const name = filename ?? fallbackFileName

  // În WebView nu există download manager — blob + <a download> nu face nimic. Scriem pe disc
  // prin plugin-ul nativ (MediaStore pe Android 10+, fără permisiuni) și confirmăm vizual.
  if (isNative) {
    await Filesystem.writeFile({
      path: name,
      data: await blobToBase64(blob),
      directory: Directory.Documents,
      recursive: true,
    })
    toast.success(t('common:shell.savedToDocuments', { name }))
    return
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  /** For totals: the figures together with the currency the server computed them in. */
  getWithMoney: async <T>(path: string): Promise<{ data: T; money: MoneyMeta }> => {
    const body = await requestEnvelope<T>(path)
    return { data: body.data, money: body.money ?? { currency: BASE_CURRENCY, converted: false, rateSource: 'BNR' } }
  },
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'DELETE', body: body === undefined ? undefined : JSON.stringify(body) }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: 'POST', body: formData }),
  download: downloadFile,
  getBlob: fetchBlob,
}
