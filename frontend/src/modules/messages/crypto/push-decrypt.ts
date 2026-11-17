// Service-worker helper bundled to public/push-decrypt.js (IIFE) by vite.config.ts.
// Decrypts a Web Push Megolm payload using the local IndexedDB store (same origin, under
// the shared Web Lock) without ever holding keys on the server.
import { InboundGroupSession, initAsync } from '@towns-protocol/vodozemac'
import { fromBase64, unpackCiphertext } from './primitives.js'

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(store)) return resolve(undefined)
    const req = db.transaction(store, 'readonly').objectStore(store).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

function openDb(userId: string): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const req = indexedDB.open(`vana-e2e-${userId}`, 1)
    req.onupgradeneeded = () => {
      // Do not create an empty store if the user never initialized E2E here.
      req.transaction?.abort()
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
}

async function withLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks
  if (!locks?.request) return fn()
  return locks.request(`vana-e2e:${userId}`, fn)
}

export interface PushDecryptInput {
  userId: string
  conversationId: string
  ciphertext: string
}

export interface PushDecryptOutput {
  body: string
  hasAttachments: boolean
}

export async function decryptPush(input: PushDecryptInput): Promise<PushDecryptOutput | null> {
  const packed = unpackCiphertext(input.ciphertext)
  if (!packed) return null

  return withLock(input.userId, async () => {
    const db = await openDb(input.userId)
    if (!db) return null
    try {
      const pickleKeyB64 = await idbGet<string>(db, 'meta', 'pickleKey')
      const record = await idbGet<{ conversationId: string; pickle: string }>(db, 'inbound', packed.sessionId)
      if (!pickleKeyB64 || !record || record.conversationId !== input.conversationId) return null

      await initAsync()
      const session = InboundGroupSession.from_pickle(record.pickle, fromBase64(pickleKeyB64))
      try {
        const decrypted = session.decrypt(packed.ciphertext)
        const parsed = JSON.parse(decrypted.plaintext) as {
          v?: number
          conversationId?: string
          body?: string
          attachments?: unknown[]
        }
        decrypted.free()
        if (parsed.v !== 1 || parsed.conversationId !== input.conversationId) return null
        return {
          body: String(parsed.body ?? ''),
          hasAttachments: Array.isArray(parsed.attachments) && parsed.attachments.length > 0,
        }
      } finally {
        session.free()
      }
    } catch {
      return null
    } finally {
      db.close()
    }
  })
}
