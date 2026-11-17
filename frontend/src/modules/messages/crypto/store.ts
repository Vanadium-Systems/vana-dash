// Where a device keeps its keys: IndexedDB, never localStorage (any script reads that
// synchronously, and it is copied into crash reports). One database per person, so two people
// sharing a browser profile do not share keys. Wiped on logout (wipeCryptoStore).

export type StoreName =
  // account pickle, device id, secrets, pinned colleague keys
  | 'meta'
  // Olm sessions, by the other device's identity key: newest first
  | 'olm'
  // this device's outgoing Megolm session, by conversation
  | 'outbound'
  // incoming Megolm sessions, by session id
  | 'inbound'
  // decrypted messages, by id: previews, reply quotes and the local search
  | 'plain'

const STORES: StoreName[] = ['meta', 'olm', 'outbound', 'inbound', 'plain']
const VERSION = 1

export interface CryptoStore {
  get<T>(store: StoreName, key: string): Promise<T | undefined>
  put(store: StoreName, key: string, value: unknown): Promise<void>
  delete(store: StoreName, key: string): Promise<void>
  values<T>(store: StoreName): Promise<T[]>
}

function databaseName(userId: string): string {
  return `vana-e2e-${userId}`
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function openCryptoStore(userId: string): Promise<CryptoStore> {
  const openReq = indexedDB.open(databaseName(userId), VERSION)
  openReq.onupgradeneeded = () => {
    for (const name of STORES) if (!openReq.result.objectStoreNames.contains(name)) openReq.result.createObjectStore(name)
  }
  const idb = await request(openReq)
  const tx = (store: StoreName, mode: IDBTransactionMode) => idb.transaction(store, mode).objectStore(store)
  return {
    get: <T>(store: StoreName, key: string) => request(tx(store, 'readonly').get(key)) as Promise<T | undefined>,
    put: async (store, key, value) => {
      await request(tx(store, 'readwrite').put(value, key))
    },
    delete: async (store, key) => {
      await request(tx(store, 'readwrite').delete(key))
    },
    values: <T>(store: StoreName) => request(tx(store, 'readonly').getAll()) as Promise<T[]>,
  }
}

export function memoryCryptoStore(): CryptoStore {
  const data = new Map<StoreName, Map<string, unknown>>(STORES.map((name) => [name, new Map()]))
  // Structured clone, as IndexedDB does: a caller mutating a value later does not change the store.
  return {
    get: async <T>(store: StoreName, key: string) => structuredClone(data.get(store)!.get(key)) as T | undefined,
    put: async (store, key, value) => {
      data.get(store)!.set(key, structuredClone(value))
    },
    delete: async (store, key) => {
      data.get(store)!.delete(key)
    },
    values: async <T>(store: StoreName) => [...data.get(store)!.values()].map((value) => structuredClone(value)) as T[],
  }
}

/** Logout: the keys go with the session (PLAN.md lesson 5). The server revokes the device with it. */
export async function wipeCryptoStore(userId: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(databaseName(userId))
    req.onsuccess = req.onerror = req.onblocked = () => resolve()
  })
}
