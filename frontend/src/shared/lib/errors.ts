import { toast, type ToastOptions } from 'sonner'
import { ApiError } from './api'
import { t, type TKey } from './i18n'

// The one way a page shows an error (PLAN E3). The server already sends the text in the
// person's language; `common:errors.codes.<CODE>` overrides it only where the page wants its own
// words (an action of the page: "Upload the file again").

function overrideText(code: string): string | null {
  const key = `common:errors.codes.${code}` as TKey
  const text = t(key)
  return text === key ? null : text
}

export function errorCode(err: unknown): string | null {
  return err instanceof ApiError && err.code ? err.code : null
}

/** A detail the server sent with the error (`existing`, `limit`): on the error object, or at the top for older routes. */
export function errorDetail<T>(err: unknown, key: string): T | undefined {
  if (!(err instanceof ApiError) || !err.body || typeof err.body !== 'object') return undefined
  const body = err.body as Record<string, unknown>
  const onError = body.error && typeof body.error === 'object' ? (body.error as Record<string, unknown>)[key] : undefined
  return (onError ?? body[key]) as T | undefined
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const override = err.code ? overrideText(err.code) : null
    return override ?? (err.message || t('common:errors.unexpected'))
  }
  // A TypeError is a failed fetch or a bug, an aborted request a DOMException: neither has text for a person.
  if (err instanceof TypeError || err instanceof DOMException) {
    return err instanceof TypeError && /fetch|network/i.test(err.message) ? t('common:errors.api.network') : t('common:errors.unexpected')
  }
  // The app's own errors (`throw new Error(t(...))` in a page) are written for the person.
  if (err instanceof Error && err.message) return err.message
  return t('common:errors.unexpected')
}

/** The code is worth showing only where someone would read it out when asking for help (Q1). */
function codeWorthShowing(err: unknown): string | null {
  if (!(err instanceof ApiError) || !err.code) return null
  return err.status >= 500 || /_(UNAVAILABLE|FAILED|UNREACHABLE)$/.test(err.code) ? err.code : null
}

/** The text and the code line of a failure the server kept as a code (a send, a sync run), from `common:errors.codes.<CODE>`. */
export function failureText(code: string): string {
  return overrideText(code) ?? t('common:errors.unexpected')
}

export function failureCodeLine(code: string): string {
  return t('common:errors.codeLine', { code })
}

/** Both on one line, for a table cell. */
export function failureLine(code: string): string {
  return `${failureText(code)} ${failureCodeLine(code)}`
}

export function toastError(err: unknown, fallback?: string, options?: ToastOptions): void {
  const known = err instanceof Error
  const code = codeWorthShowing(err)
  const description = code ? { description: t('common:errors.codeLine', { code }) } : undefined
  toast.error(known || !fallback ? errorText(err) : fallback, options || description ? { ...options, ...description } : undefined)
}
