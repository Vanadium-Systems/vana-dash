import { lookupCompanyByCui, type AnafCompanyInfo } from '../../shared/lib/anaf-lookup.js'
import { normalizeCui } from '../../shared/lib/cui-validator.js'

// The gate every call to ANAF's public lookup goes through (CLAUDE.md: no bursts to public state
// sources). One request in flight, at least 2s apart, 24h cache per CUI, and after a 403 / 429 no
// request for an hour.

const MIN_GAP_MS = 2_000
const CACHE_MS = 24 * 60 * 60 * 1000
const BLOCK_MS = 60 * 60 * 1000

const cache = new Map<string, { at: number; info: AnafCompanyInfo }>()
let queue: Promise<unknown> = Promise.resolve()
let lastAt = 0
let blockedUntil = 0

export class LookupBlockedError extends Error {
  readonly statusCode = 503
}

export async function lookupCompany(rawCui: string): Promise<AnafCompanyInfo> {
  const cui = normalizeCui(rawCui) ?? rawCui
  const hit = cache.get(cui)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.info

  const run = queue.then(async () => {
    if (Date.now() < blockedUntil) throw new LookupBlockedError('ANAF lookup paused after a 403/429')
    const wait = lastAt + MIN_GAP_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastAt = Date.now()
    try {
      const info = await lookupCompanyByCui(cui)
      cache.set(cui, { at: Date.now(), info })
      return info
    } catch (err) {
      if (/HTTP (403|429)\b/.test(String(err))) blockedUntil = Date.now() + BLOCK_MS
      throw err
    }
  })
  queue = run.catch(() => undefined)
  return run
}

/** Romanian numbers to E.164; anything else keeps its digits with a "+". */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (/^0040\d{9}$/.test(digits)) return '+' + digits.slice(2)
  if (/^40\d{9}$/.test(digits)) return '+' + digits
  if (/^0\d{9}$/.test(digits)) return '+40' + digits.slice(1)
  return digits ? '+' + digits : raw.trim().toLowerCase()
}
