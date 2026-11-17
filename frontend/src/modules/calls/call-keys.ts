// Client-side E2EE room keys for LiveKit calls.
// For guest-link calls, the key lives in the `#k=` URL fragment (never sent to the server)
// and in local storage for the creator's device so re-joining from /calls works seamlessly.
// For Mesaje calls, the key travels inside the Megolm ciphertext (MessageContent.call.key).

const STORAGE_KEY = 'vana-call-keys-v1'
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000

interface StoredEntry {
  key: string
  savedAt: number
}

export function generateCallKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function extractKeyFromHash(hash: string = window.location.hash): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return null
  const params = new URLSearchParams(raw)
  const value = params.get('k')?.trim() ?? ''
  return value.length >= 16 ? value : null
}

export function parseCallKeyFromInput(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const hashIndex = trimmed.indexOf('#')
  if (hashIndex >= 0) return extractKeyFromHash(trimmed.slice(hashIndex))
  return trimmed.length >= 16 ? trimmed : null
}

export function buildPublicCallUrl(publicUrl: string, key: string | null | undefined): string {
  if (!key) return publicUrl
  const base = publicUrl.split('#')[0]!
  return `${base}#k=${encodeURIComponent(key)}`
}

function readMap(): Record<string, StoredEntry> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, StoredEntry>
    const cutoff = Date.now() - MAX_AGE_MS
    const clean: Record<string, StoredEntry> = {}
    for (const [id, entry] of Object.entries(parsed)) {
      if (entry && typeof entry.key === 'string' && typeof entry.savedAt === 'number' && entry.savedAt >= cutoff) {
        clean[id] = entry
      }
    }
    return clean
  } catch {
    return {}
  }
}

export function saveCallKey(callId: string, key: string): void {
  try {
    const map = readMap()
    map[callId] = { key, savedAt: Date.now() }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    // Storage full or unavailable in restricted context.
  }
}

export function getCallKey(callId: string): string | null {
  const map = readMap()
  return map[callId]?.key ?? null
}
