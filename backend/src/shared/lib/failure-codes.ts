// Maps the raw text of a failure (Resend, SMTP, fetch, connectors) to a stable code at read time.
// The text stays in `email_sends.error_message` / `sync_log.error_message` and the log; answers
// carry only the code, so old rows are covered too. Patterns match both the English and the
// Romanian texts of `errors.*`, because rows were written in the language of the installation.

export type SendFailureCode =
  | 'EMAIL_SEND_RATE_LIMITED'
  | 'EMAIL_SEND_AUTH_FAILED'
  | 'EMAIL_RECIPIENT_REJECTED'
  | 'EMAIL_SEND_TIMEOUT'
  | 'EMAIL_SEND_FAILED'

export type SyncFailureCode = 'SYNC_TIMEOUT' | 'SYNC_AUTH_FAILED' | 'SYNC_UNREACHABLE' | 'SYNC_FAILED'

const TIMEOUT = /timeout|timed out|ETIMEDOUT|AbortError|operation was aborted/i

const SEND_RULES: Array<[SendFailureCode, RegExp]> = [
  ['EMAIL_SEND_RATE_LIMITED', /\bHTTP 429\b|rate[ _-]?limit|too many requests|outreach_cap_reached/i],
  ['EMAIL_SEND_AUTH_FAILED', /\bHTTP (401|403)\b|SMTP_AUTH_FAILED|EAUTH|API key|RESEND_API_KEY|unauthori[sz]ed/i],
  ['EMAIL_RECIPIENT_REJECTED', /\bHTTP 422\b|SMTP_REJECTED|IMAP_DSN|recipient_unsubscribed|EENVELOPE|invalid[^.]*\b(to|recipient|address)\b|bounce|mailbox (unavailable|not found)|user unknown|no such user/i],
  ['EMAIL_SEND_TIMEOUT', TIMEOUT],
]

const SYNC_RULES: Array<[SyncFailureCode, RegExp]> = [
  ['SYNC_TIMEOUT', TIMEOUT],
  ['SYNC_AUTH_FAILED', /\b(HTTP |returned |answered )?(401|403)\b|invalid\/expired token|token invalid|OAuth (is )?not configured|OAuth neconfigurat|unauthori[sz]ed|\bEAUTH\b/i],
  ['SYNC_UNREACHABLE', /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|fetch failed|\b(returned|HTTP) 5\d\d\b/i],
]

export function classifySendFailure(raw: string): SendFailureCode
export function classifySendFailure(raw: string | null): SendFailureCode | null
export function classifySendFailure(raw: string | null): SendFailureCode | null {
  if (raw === null) return null
  return SEND_RULES.find(([, pattern]) => pattern.test(raw))?.[0] ?? 'EMAIL_SEND_FAILED'
}

export function classifySyncFailure(raw: string): SyncFailureCode
export function classifySyncFailure(raw: string | null): SyncFailureCode | null
export function classifySyncFailure(raw: string | null): SyncFailureCode | null {
  if (raw === null) return null
  return SYNC_RULES.find(([, pattern]) => pattern.test(raw))?.[0] ?? 'SYNC_FAILED'
}
