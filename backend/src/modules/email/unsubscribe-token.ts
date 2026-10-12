import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../../shared/config.js'

// Token stateless (HMAC pe adresa normalizată) — fără tabel de token-uri separat, verificabil
// oricând fără lookup în DB. Format: base64url(email) + '.' + base64url(hmac-sha256).

function normalize(email: string): string {
  return email.trim().toLowerCase()
}

function sign(normalizedEmail: string): string {
  return createHmac('sha256', config.emailUnsubscribeSecret).update(normalizedEmail).digest('base64url')
}

/** `config.emailUnsubscribeSecret` gol = niciun token valid (fail-closed) — apelantul
 *  (bulkSend) nu trebuie să genereze link-uri rupte, dar nici să crape la trimitere. */
export function buildUnsubscribeToken(email: string): string | null {
  if (!config.emailUnsubscribeSecret) return null
  const normalized = normalize(email)
  const emailPart = Buffer.from(normalized, 'utf8').toString('base64url')
  return `${emailPart}.${sign(normalized)}`
}

/** Întoarce adresa (normalizată) dacă semnătura e validă, altfel `null` — niciodată nu aruncă
 *  (input vine direct din URL, netrusted). */
export function verifyUnsubscribeToken(token: string): string | null {
  if (!config.emailUnsubscribeSecret) return null

  const dotIndex = token.indexOf('.')
  if (dotIndex === -1) return null
  const emailPart = token.slice(0, dotIndex)
  const signaturePart = token.slice(dotIndex + 1)

  let normalized: string
  try {
    normalized = Buffer.from(emailPart, 'base64url').toString('utf8')
  } catch {
    return null
  }
  if (!normalized) return null

  const expected = sign(normalized)
  const expectedBuf = Buffer.from(expected)
  const actualBuf = Buffer.from(signaturePart)
  if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) return null

  return normalized
}
