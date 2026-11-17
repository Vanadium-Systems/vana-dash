import { toast } from 'sonner'
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

export function toastError(err: unknown, fallback?: string): void {
  const known = err instanceof Error
  const code = codeWorthShowing(err)
  toast.error(known || !fallback ? errorText(err) : fallback, code ? { description: t('common:errors.codeLine', { code }) } : undefined)
}
