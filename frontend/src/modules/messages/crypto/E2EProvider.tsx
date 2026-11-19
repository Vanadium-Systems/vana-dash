import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useChatStream } from '@/shared/components/chat/ChatStreamProvider'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import type { ChatAttachment, ChatConversation, ChatEncrypted } from '@/shared/lib/types'
import { threadQueryOptions, type ThreadPage } from '../thread-query'
import { keysApi } from './client'
import { E2EEngine, type AttachmentKey, type EngineStatus, type MessageContent, type PlainRecord } from './engine'
import { hasEd25519, isSupported, unpadded } from './primitives'
import { openCryptoStore, type CryptoStore } from './store'

// One engine per tab and person, next to the chat stream (App.tsx): previews in the list,
// notifications and the thread all decrypt through it.

type E2EState = { engine: null; status: 'off' | 'loading' | 'unsupported' | 'error' } | { engine: E2EEngine; status: EngineStatus }

const E2EContext = createContext<E2EState>({ engine: null, status: 'off' })
const StoreContext = createContext<CryptoStore | null>(null)

const CONVERSATIONS_KEY = ['chat', 'conversations']

// Decrypted messages in memory for the whole tab, loaded from IndexedDB at start. A thread then
// renders its text in the first frame instead of one "Decrypting…" per row while each row reads
// IndexedDB on its own. Keyed like the 'plain' store: an edit is a new ciphertext under the same id.
const plainMemory = new Map<string, MessageContent>()
// Encrypted on this device and not saved yet, by ciphertext: the stream can deliver the saved row
// before the POST answers with its id.
const sentMemory = new Map<string, MessageContent>()
let memoryStore: CryptoStore | null = null

function ciphertextTail(ciphertext: string): string {
  return unpadded(ciphertext).slice(-24)
}

function memoryKey(id: string, ciphertext: string): string {
  return `${id}:${ciphertextTail(ciphertext)}`
}

function fromMemory(message: { id?: string; encrypted?: ChatEncrypted | null }): MessageContent | undefined {
  if (!message.encrypted) return undefined
  const kept = message.id ? plainMemory.get(memoryKey(message.id, message.encrypted.ciphertext)) : undefined
  return kept ?? sentMemory.get(ciphertextTail(message.encrypted.ciphertext))
}

function contentOf(record: PlainRecord): MessageContent {
  return { body: record.body, attachments: record.attachments, ...(record.call ? { call: record.call } : {}) }
}

async function loadMemory(store: CryptoStore): Promise<void> {
  plainMemory.clear()
  for (const [key, record] of await store.entries<PlainRecord>('plain')) plainMemory.set(key, contentOf(record))
}

/** Marks a message this device just encrypted as readable before the server gives it an id. */
export function rememberSent(encrypted: ChatEncrypted, content: MessageContent): void {
  sentMemory.set(ciphertextTail(encrypted.ciphertext), content)
}

/**
 * Decrypts the latest page of every conversation in the background, one message at a time, so
 * opening any of them later is instant. What was decrypted once stays in IndexedDB, so after
 * the first start this only touches messages that arrived while the app was closed.
 */
async function warmUp(queryClient: ReturnType<typeof useQueryClient>, engine: E2EEngine, cancelled: () => boolean): Promise<void> {
  const conversations =
    queryClient.getQueryData<ChatConversation[]>(CONVERSATIONS_KEY) ?? (await api.get<ChatConversation[]>('/api/chat/conversations'))
  for (const conversation of conversations) {
    if (cancelled()) return
    if (!conversation.lastMessage) continue
    const options = threadQueryOptions(conversation.id)
    const page = queryClient.getQueryData<ThreadPage>(options.queryKey) ?? (await queryClient.fetchQuery(options))
    for (const message of page?.messages ?? []) {
      if (cancelled() || engine.currentStatus !== 'ready') return
      if (!message.encrypted || message.deletedAt || fromMemory(message)) continue
      const result = await engine.decrypt({ ...message, encrypted: message.encrypted })
      if (result.status === 'ok') plainMemory.set(memoryKey(message.id, message.encrypted.ciphertext), result.content)
    }
  }
}

export function E2EProvider({ children }: { children: ReactNode }) {
  const { session, can } = useMe()
  const userId = session?.user.id
  const enabled = can('mesaje.view') && Boolean(userId)
  const queryClient = useQueryClient()
  const { subscribe, status: streamStatus } = useChatStream()
  const [state, setState] = useState<E2EState>({ engine: null, status: 'off' })
  const [store, setStore] = useState<CryptoStore | null>(null)

  useEffect(() => {
    if (!enabled || !userId) return
    let cancelled = false
    let unsubscribe = () => {}
    setState({ engine: null, status: 'loading' })
    void (async () => {
      if (!isSupported() || !(await hasEd25519())) {
        if (!cancelled) setState({ engine: null, status: 'unsupported' })
        return
      }
      // Open IndexedDB immediately so cached plaintexts render before WASM + /keys/me finish.
      const cryptoStore = await openCryptoStore(userId)
      sentMemory.clear()
      await loadMemory(cryptoStore)
      if (cancelled) return
      memoryStore = cryptoStore
      setStore(cryptoStore)
      const membersOf = async (conversationId: string) => {
        const list =
          queryClient.getQueryData<ChatConversation[]>(CONVERSATIONS_KEY) ??
          (await api.get<ChatConversation[]>('/api/chat/conversations'))
        return list.find((conversation) => conversation.id === conversationId)?.members.map((member) => member.id) ?? []
      }
      const engine = new E2EEngine(userId, cryptoStore, keysApi, membersOf)
      const status = await engine.init()
      if (cancelled) return
      unsubscribe = engine.subscribe(() => {
        setState({ engine, status: engine.currentStatus })
        // Re-try rows that missed the cache before ready or were waiting for a key.
        void queryClient.invalidateQueries({
          queryKey: ['chat', 'plain'],
          predicate: (q) => q.state.data === null || q.state.data === 'missing-key',
        })
      })
      setState({ engine, status })
      if (status !== 'ready') {
        // Device may have been revoked and plain store wiped: drop any pre-init cache hits.
        await loadMemory(cryptoStore)
        void queryClient.invalidateQueries({ queryKey: ['chat', 'plain'] })
      }
      await engine.syncToDevice()
      if (engine.currentStatus === 'ready') {
        void warmUp(queryClient, engine, () => cancelled).catch((err) => console.warn('[e2e] warm-up stopped', err))
      }
    })().catch((err) => {
      console.error('[e2e] start failed', err)
      if (!cancelled) setState({ engine: null, status: 'error' })
    })
    return () => {
      cancelled = true
      unsubscribe()
      plainMemory.clear()
      sentMemory.clear()
      memoryStore = null
    }
  }, [enabled, userId, queryClient])

  const engine = state.engine
  // A stream that was down (tab hidden, phone asleep) missed its wake-ups: read the queue on return.
  useEffect(() => {
    if (engine && streamStatus === 'live') void engine.syncToDevice().catch(() => undefined)
  }, [engine, streamStatus])

  useEffect(() => {
    if (!engine) return
    return subscribe((event) => {
      if (event.type === 'keys.to_device') void engine.syncToDevice().catch(() => undefined)
      if (event.type === 'keys.devices') engine.forgetDevices(event.userId)
      if (event.type === 'message.created') {
        // A conversation that is not open keeps its page current too, already decrypted.
        const { message } = event
        queryClient.setQueryData<ThreadPage>(threadQueryOptions(event.conversationId).queryKey, (current) =>
          current && !current.messages.some((m) => m.id === message.id || m.clientId === message.clientId)
            ? { ...current, messages: [...current.messages, message] }
            : current,
        )
        if (message.encrypted && !fromMemory(message) && engine.currentStatus === 'ready') {
          void engine.decrypt({ ...message, encrypted: message.encrypted }).then((result) => {
            if (result.status === 'ok') plainMemory.set(memoryKey(message.id, message.encrypted!.ciphertext), result.content)
          })
        }
      }
    })
  }, [engine, subscribe, queryClient])

  return (
    <StoreContext.Provider value={store}>
      <E2EContext.Provider value={state}>{children}</E2EContext.Provider>
    </StoreContext.Provider>
  )
}

/** The engine and its status; re-renders on every engine change (approvals, changed keys). */
export function useE2E(): E2EState {
  return useContext(E2EContext)
}

export type Decrypted =
  | { state: 'ready'; content: MessageContent }
  // Not decrypted yet: the engine is starting, or this device is not set up.
  | { state: 'pending' }
  | { state: 'missing-key' }
  | { state: 'invalid' }

interface Decryptable {
  id: string
  conversationId: string
  authorUserId: string
  body: string
  encrypted: ChatEncrypted | null
}

function plainKey(message: { id?: string; encrypted: ChatEncrypted | null }, ready: boolean) {
  return ['chat', 'plain', message.id, message.encrypted?.ciphertext.slice(-24), ready ? 1 : 0]
}

/** Pre-populates the decrypted cache for a message we just encrypted and sent, avoiding a "Decrypting…" flash. */
export function seedPlainCache(
  queryClient: ReturnType<typeof useQueryClient>,
  message: { id: string; conversationId: string; authorUserId: string; createdAt?: string; encrypted?: ChatEncrypted | null },
  content: MessageContent,
): void {
  if (!message.encrypted) return
  const key = memoryKey(message.id, message.encrypted.ciphertext)
  plainMemory.set(key, content)
  sentMemory.delete(ciphertextTail(message.encrypted.ciphertext))
  // Kept like a decrypted message, so a reload does not decrypt your own words again.
  void memoryStore
    ?.put('plain', key, {
      messageId: message.id,
      conversationId: message.conversationId,
      authorUserId: message.authorUserId,
      createdAt: message.createdAt,
      ...content,
    } satisfies PlainRecord)
    .catch(() => undefined)
  queryClient.setQueryData(plainKey({ id: message.id, encrypted: message.encrypted }, true), content)
  queryClient.setQueryData(plainKey({ id: message.id, encrypted: message.encrypted }, false), content)
}

/** An attachment as the UI shows it: its real name and type once the message is decrypted. */
export type ResolvedAttachment = ChatAttachment & { key?: AttachmentKey }

type RowLike = {
  id?: string
  conversationId: string
  authorUserId: string
  createdAt: string
  body: string
  encrypted?: ChatEncrypted | null
  attachments: ResolvedAttachment[]
}

async function decryptWithCache(
  store: CryptoStore | null,
  engine: E2EEngine | null,
  status: E2EState['status'],
  message: { id: string; conversationId: string; authorUserId: string; createdAt?: string; encrypted: ChatEncrypted },
): Promise<MessageContent | 'missing-key' | 'invalid' | null> {
  const remembered = fromMemory(message)
  if (remembered) return remembered
  const cacheKey = memoryKey(message.id, message.encrypted.ciphertext)
  if (store?.get) {
    const cached = await store.get<PlainRecord>('plain', cacheKey)
    if (cached) {
      plainMemory.set(cacheKey, contentOf(cached))
      return contentOf(cached)
    }
  }
  if (!engine || status !== 'ready') return null
  const result = await engine.decrypt(message)
  if (result.status !== 'ok') return result.status
  plainMemory.set(cacheKey, result.content)
  return result.content
}

/**
 * A thread's rows with the text decrypted and the attachments named, so everything downstream
 * (bubble, copy, edit, reply, "emoji only") reads `body` as before. `e2e` says why a row has no
 * text yet.
 */
export function useDecryptedRows<T extends RowLike>(rows: T[]): (T & { e2e: Decrypted['state'] | null })[] {
  const { engine, status } = useE2E()
  const store = useContext(StoreContext)
  const ready = status === 'ready'
  const results = useQueries({
    queries: rows.map((row) => ({
      queryKey: plainKey({ id: row.id, encrypted: row.encrypted ?? null }, ready),
      enabled: Boolean(row.id && row.encrypted && (store || (engine && ready))),
      staleTime: Infinity,
      gcTime: 10 * 60_000,
      initialData: () => fromMemory(row),
      placeholderData: (prev: MessageContent | 'missing-key' | 'invalid' | null | undefined) => prev,
      queryFn: () =>
        decryptWithCache(store, engine, status, {
          id: row.id!,
          conversationId: row.conversationId,
          authorUserId: row.authorUserId,
          createdAt: row.createdAt,
          encrypted: row.encrypted!,
        }),
    })),
  })
  return rows.map((row, index) => {
    if (!row.encrypted) return { ...row, e2e: null }
    const data = results[index]?.data
    if (data === undefined || data === null) return { ...row, e2e: 'pending' as const }
    if (data === 'missing-key' || data === 'invalid') return { ...row, e2e: data }
    const keys = new Map(data.attachments.map((key) => [key.id, key]))
    return {
      ...row,
      body: data.body,
      attachments: row.attachments.map((attachment) => {
        const key = keys.get(attachment.id)
        return key ? { ...attachment, filename: key.name, contentType: key.type, sizeBytes: key.size, key } : attachment
      }),
      callKey: data.call?.key,
      e2e: 'ready' as const,
    }
  })
}

/** A message's text and file keys: clear for old messages, decrypted on this device otherwise. */
export function useDecrypted(message: Decryptable | null): Decrypted {
  const { engine, status } = useE2E()
  const store = useContext(StoreContext)
  const encrypted = message?.encrypted ?? null
  const ready = status === 'ready'
  const query = useQuery({
    queryKey: plainKey({ id: message?.id, encrypted }, ready),
    enabled: Boolean(message && encrypted && (store || (engine && ready))),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    initialData: () => (message ? fromMemory(message) : undefined),
    placeholderData: (prev) => prev,
    queryFn: () => decryptWithCache(store, engine, status, { ...message!, encrypted: encrypted! }),
  })
  if (!message) return { state: 'pending' }
  if (!encrypted) return { state: 'ready', content: { body: message.body, attachments: [] } }
  if (query.data === undefined || query.data === null) return { state: 'pending' }
  if (query.data === 'missing-key' || query.data === 'invalid') return { state: query.data }
  return { state: 'ready', content: query.data }
}

/** Decrypts on demand outside React (copy, edit, reply): the same cache as useDecrypted. */
export async function decryptNow(engine: E2EEngine | null, message: Decryptable): Promise<MessageContent | null> {
  if (!message.encrypted) return { body: message.body, attachments: [] }
  const remembered = fromMemory(message)
  if (remembered) return remembered
  if (!engine) return null
  const result = await engine.decrypt({ ...message, encrypted: message.encrypted })
  return result.status === 'ok' ? result.content : null
}
