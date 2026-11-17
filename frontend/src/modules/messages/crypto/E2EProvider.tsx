import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useChatStream } from '@/shared/components/chat/ChatStreamProvider'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import type { ChatAttachment, ChatConversation, ChatEncrypted } from '@/shared/lib/types'
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
      if (cancelled) return
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
        void queryClient.invalidateQueries({ queryKey: ['chat', 'plain'] })
      }
      await engine.syncToDevice()
    })().catch((err) => {
      console.error('[e2e] start failed', err)
      if (!cancelled) setState({ engine: null, status: 'error' })
    })
    return () => {
      cancelled = true
      unsubscribe()
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
    })
  }, [engine, subscribe])

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
  message: { id: string; encrypted?: ChatEncrypted | null },
  content: MessageContent,
): void {
  if (!message.encrypted) return
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
  if (store?.get) {
    const cacheKey = `${message.id}:${unpadded(message.encrypted.ciphertext).slice(-24)}`
    const cached = await store.get<PlainRecord>('plain', cacheKey)
    if (cached) return { body: cached.body, attachments: cached.attachments, ...(cached.call ? { call: cached.call } : {}) }
  }
  if (!engine || status !== 'ready') return null
  const result = await engine.decrypt(message)
  return result.status === 'ok' ? result.content : result.status
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
  if (!engine) return null
  const result = await engine.decrypt({ ...message, encrypted: message.encrypted })
  return result.status === 'ok' ? result.content : null
}
