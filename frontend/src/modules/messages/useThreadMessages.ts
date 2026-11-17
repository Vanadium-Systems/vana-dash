import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChatStream } from '@/shared/components/chat/ChatStreamProvider'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { ChatAttachment, ChatConversation, ChatMessage, ChatReaction, ChatReceipt, ChatReplyPreview, RefType } from '@/shared/lib/types'
import type { AttachmentKey } from './crypto/engine'
import { decryptNow, seedPlainCache, useE2E } from './crypto/E2EProvider'

// The thread of one conversation. The latest page is a query, kept current by the stream. Older
// pages loaded by scrolling up sit in `older`. A jump (a quoted message, a search hit, a date)
// opens a detached `window` around the target: while it is open, new messages from the stream go
// to the query only and are counted on the "down" button, so nothing is glued onto a window that
// does not reach the end. Returning to the latest drops the window.
//
// The server dedupes on `clientId`, so retrying a send is safe.
//
// Text and file keys are encrypted here, just before sending (PLAN.md part M); a retry encrypts
// again, which is fine: the server keeps the first copy it got for that clientId.

/** An uploaded attachment with the key that decrypts it, until it is sent inside a message. */
export type OutgoingAttachment = ChatAttachment & { key: AttachmentKey }

export interface PendingMessage {
  clientId: string
  body: string
  attachments: OutgoingAttachment[]
  replyTo: ChatReplyPreview | null
  createdAt: string
  status: 'sending' | 'failed'
  error: string | null
  input: SendInput
}

export interface RefInput {
  type: RefType
  id: string
  quote?: string
  title: string
}

export interface SendInput {
  body: string
  attachments: OutgoingAttachment[]
  replyTo?: ChatReplyPreview | null
  refs?: RefInput[]
}

const PAGE_SIZE = 50

type ThreadPage = {
  messages: ChatMessage[]
  hasMore: boolean
  hasNewer: boolean
  receipts: ChatReceipt[]
  lastReadMessageId: string | null
}

interface DetachedWindow {
  messages: ChatMessage[]
  hasMore: boolean
  hasNewer: boolean
}

/** Moves a member's receipt forward, never back; members not in the list are the viewer. */
function advanceReceipt(receipts: ChatReceipt[], userId: string, field: 'deliveredUpTo' | 'readUpTo', at: string): ChatReceipt[] {
  return receipts.map((r) => (r.userId === userId && (!r[field] || Date.parse(r[field]!) < Date.parse(at)) ? { ...r, [field]: at } : r))
}

function appendUnique(list: ChatMessage[], extra: ChatMessage[]): ChatMessage[] {
  const seen = new Set(list.map((m) => m.id))
  return [...list, ...extra.filter((m) => !seen.has(m.id))]
}

export function useThreadMessages(conversationId: string | undefined) {
  const queryClient = useQueryClient()
  const { subscribe } = useChatStream()
  const { engine } = useE2E()
  const [older, setOlder] = useState<{ messages: ChatMessage[]; hasMore: boolean }>({ messages: [], hasMore: false })
  const [detached, setDetached] = useState<DetachedWindow | null>(null)
  const [arrivedWhileDetached, setArrivedWhileDetached] = useState(0)
  const [pending, setPending] = useState<PendingMessage[]>([])
  const [loading, setLoading] = useState<'older' | 'newer' | 'jump' | null>(null)
  const detachedRef = useRef(detached)
  detachedRef.current = detached
  const queryKey = useMemo(() => ['chat', 'messages', conversationId ?? ''] as const, [conversationId])
  const base = `/api/chat/conversations/${conversationId}/messages`

  const query = useQuery({
    queryKey,
    queryFn: () => api.get<ThreadPage>(`${base}?limit=${PAGE_SIZE}`),
    enabled: Boolean(conversationId),
    staleTime: 10_000,
  })

  // Where the "New" line goes: the watermark as it was when the conversation was opened, kept
  // until it is opened again, even though reading moves the real one.
  const [openedReadId, setOpenedReadId] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (openedReadId === undefined && query.data) setOpenedReadId(query.data.lastReadMessageId)
  }, [openedReadId, query.data])

  useEffect(() => {
    setOlder({ messages: [], hasMore: false })
    setDetached(null)
    setArrivedWhileDetached(0)
    setPending([])
    setOpenedReadId(undefined)
  }, [conversationId])

  /** Applies a change to one message wherever it is loaded. */
  const patchMessage = useCallback(
    (messageId: string, change: (message: ChatMessage) => ChatMessage) => {
      const apply = (list: ChatMessage[]) => list.map((m) => (m.id === messageId ? change(m) : m))
      queryClient.setQueryData<ThreadPage>(queryKey, (current) => (current ? { ...current, messages: apply(current.messages) } : current))
      setOlder((current) => ({ ...current, messages: apply(current.messages) }))
      setDetached((current) => (current ? { ...current, messages: apply(current.messages) } : current))
    },
    [queryClient, queryKey],
  )

  useEffect(
    () =>
      subscribe((event) => {
        if (!conversationId || !('conversationId' in event) || event.conversationId !== conversationId) return
        if (event.type === 'message.created') {
          // The optimistic copy stays until the POST answers with the real id; dedupe on clientId.
          queryClient.setQueryData<ThreadPage>(queryKey, (current) =>
            current && !current.messages.some((m) => m.id === event.message.id || m.clientId === event.message.clientId)
              ? { ...current, messages: [...current.messages, event.message] }
              : current,
          )
          if (detachedRef.current) setArrivedWhileDetached((count) => count + 1)
        }
        if (event.type === 'read') {
          queryClient.setQueryData<ThreadPage>(queryKey, (current) => {
            const read = current?.messages.find((m) => m.id === event.messageId)
            if (!current || !read) return current
            const receipts = advanceReceipt(current.receipts, event.userId, 'readUpTo', read.createdAt)
            return { ...current, receipts: receipts.map((r) => (r.userId === event.userId ? { ...r, readAt: event.at } : r)) }
          })
        }
        if (event.type === 'delivered') {
          queryClient.setQueryData<ThreadPage>(queryKey, (current) =>
            current ? { ...current, receipts: advanceReceipt(current.receipts, event.userId, 'deliveredUpTo', event.at) } : current,
          )
        }
        if (event.type === 'message.updated') {
          // A deletion carries only the id.
          const update = event.message
          patchMessage(update.id, (m) =>
            Object.keys(update).length === 1 ? { ...m, body: '', deletedAt: m.deletedAt ?? new Date().toISOString(), refs: [], reactions: [] } : { ...m, ...update },
          )
        }
        if (event.type === 'reaction.updated') {
          patchMessage(event.messageId, (m) => ({ ...m, reactions: event.reactions }))
        }
      }),
    [conversationId, patchMessage, queryClient, queryKey, subscribe],
  )

  const returnToLatest = useCallback(() => {
    setDetached(null)
    setArrivedWhileDetached(0)
    setOlder({ messages: [], hasMore: false })
    void queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  const send = useCallback(
    async (input: SendInput): Promise<void> => {
      if (!conversationId) return
      const clientId = crypto.randomUUID()
      setPending((current) => [
        ...current,
        {
          clientId,
          body: input.body,
          attachments: input.attachments,
          replyTo: input.replyTo ?? null,
          createdAt: new Date().toISOString(),
          status: 'sending',
          error: null,
          input,
        },
      ])
      // Your own message always brings you to the end.
      if (detachedRef.current) returnToLatest()

      const members = async () => {
        const list =
          queryClient.getQueryData<ChatConversation[]>(['chat', 'conversations']) ??
          (await api.get<ChatConversation[]>('/api/chat/conversations'))
        return list.find((c) => c.id === conversationId)?.members.map((m) => m.id) ?? []
      }
      const payload = {
        body: '',
        clientId,
        attachmentIds: input.attachments.map((a) => a.id),
        replyToId: input.replyTo?.id,
        refs: (input.refs ?? []).map(({ type, id, quote }) => ({ type, id, quote })),
      }
      try {
        // A message with only shared objects has nothing to encrypt; the objects are references.
        const hasContent = input.body !== '' || input.attachments.length > 0
        if (hasContent && engine?.currentStatus !== 'ready') throw new Error(t('messages:e2e.notReady'))
        const encrypted = hasContent
          ? await engine!.encrypt(conversationId, await members(), { body: input.body, attachments: input.attachments.map((a) => a.key) })
          : undefined
        const saved = await api.post<ChatMessage>(base, { ...payload, encrypted })
        const content = { body: input.body, attachments: input.attachments.map((a) => a.key) }
        seedPlainCache(queryClient, saved, content)
        // Saved copy first, optimistic one after: the thread hides a pending row once its clientId
        // is in the list, so it never shrinks for a frame (that made the thread jump).
        queryClient.setQueryData<ThreadPage>(queryKey, (current) =>
          current && !current.messages.some((m) => m.id === saved.id || m.clientId === clientId)
            ? { ...current, messages: [...current.messages, saved] }
            : current,
        )
        setPending((current) => current.filter((m) => m.clientId !== clientId))
        void queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] })
      } catch (err) {
        // Stays in the thread as "Not sent · Retry", not a toast that goes away.
        setPending((current) =>
          current.map((m) => (m.clientId === clientId ? { ...m, status: 'failed', error: err instanceof Error ? err.message : String(err) } : m)),
        )
      }
    },
    [base, conversationId, engine, queryClient, queryKey, returnToLatest],
  )

  const retry = useCallback(
    async (clientId: string) => {
      const failed = pending.find((m) => m.clientId === clientId)
      if (!failed) return
      setPending((current) => current.filter((m) => m.clientId !== clientId))
      await send(failed.input)
    },
    [pending, send],
  )

  const discard = useCallback((clientId: string) => {
    setPending((current) => current.filter((m) => m.clientId !== clientId))
  }, [])

  const live = query.data
  const messages = detached ? detached.messages : appendUnique(older.messages, live?.messages ?? [])
  const hasMore = detached ? detached.hasMore : older.messages.length > 0 ? older.hasMore : (live?.hasMore ?? false)
  const hasNewer = detached ? detached.hasNewer : false

  const loadOlder = useCallback(async () => {
    const first = messages[0]
    if (!conversationId || !first || loading) return
    setLoading('older')
    try {
      const page = await api.get<ThreadPage>(`${base}?before=${first.id}&limit=${PAGE_SIZE}`)
      if (detachedRef.current) {
        setDetached((current) => (current ? { ...current, messages: appendUnique(page.messages, current.messages), hasMore: page.hasMore } : current))
      } else {
        setOlder((current) => ({ messages: appendUnique(page.messages, current.messages), hasMore: page.hasMore }))
      }
    } finally {
      setLoading(null)
    }
  }, [base, conversationId, loading, messages])

  const loadNewer = useCallback(async () => {
    const window = detachedRef.current
    const last = window?.messages[window.messages.length - 1]
    if (!window || !last || loading) return
    setLoading('newer')
    try {
      const page = await api.get<ThreadPage>(`${base}?after=${last.id}&limit=${PAGE_SIZE}`)
      if (!page.hasNewer) {
        // Reached the end: the live page takes over, with what the window had loaded before it.
        const latest = queryClient.getQueryData<ThreadPage>(queryKey)
        const firstLive = latest?.messages[0]
        const before = appendUnique(window.messages, page.messages).filter(
          (m) => !firstLive || Date.parse(m.createdAt) < Date.parse(firstLive.createdAt),
        )
        setOlder({ messages: before, hasMore: window.hasMore })
        setDetached(null)
        setArrivedWhileDetached(0)
        void queryClient.invalidateQueries({ queryKey })
        return
      }
      setDetached((current) => (current ? { ...current, messages: appendUnique(current.messages, page.messages), hasNewer: page.hasNewer } : current))
    } finally {
      setLoading(null)
    }
  }, [base, loading, queryClient, queryKey])

  /** Opens a window around a message, unless it is already loaded. */
  const jumpTo = useCallback(
    async (target: { messageId: string } | { date: string }): Promise<string | null> => {
      if ('messageId' in target && messages.some((m) => m.id === target.messageId)) return target.messageId
      if (!conversationId) return null
      setLoading('jump')
      try {
        const param = 'messageId' in target ? `around=${target.messageId}` : `aroundDate=${encodeURIComponent(target.date)}`
        const page = await api.get<ThreadPage>(`${base}?${param}`)
        if (!page.hasNewer) {
          // The window reaches the end: no need to detach.
          setOlder({ messages: page.messages, hasMore: page.hasMore })
          setDetached(null)
          void queryClient.invalidateQueries({ queryKey })
        } else {
          setDetached({ messages: page.messages, hasMore: page.hasMore, hasNewer: true })
          setArrivedWhileDetached(0)
        }
        if ('messageId' in target) return target.messageId
        const day = Date.parse(target.date)
        return page.messages.find((m) => Date.parse(m.createdAt) >= day)?.id ?? page.messages[page.messages.length - 1]?.id ?? null
      } finally {
        setLoading(null)
      }
    },
    [base, conversationId, messages, queryClient, queryKey],
  )

  const edit = useCallback(
    async (messageId: string, body: string) => {
      const message = messages.find((m) => m.id === messageId)
      if (!message || !conversationId || engine?.currentStatus !== 'ready') throw new Error(t('messages:e2e.notReady'))
      // The files stay: their keys go into the new ciphertext along with the new text.
      const before = await decryptNow(engine, message)
      const members =
        queryClient.getQueryData<ChatConversation[]>(['chat', 'conversations'])?.find((c) => c.id === conversationId)?.members.map((m) => m.id) ??
        [message.authorUserId]
      const encrypted = await engine.encrypt(conversationId, members, { body, attachments: before?.attachments ?? [] })
      const saved = await api.patch<ChatMessage>(`/api/chat/messages/${messageId}`, { encrypted })
      patchMessage(messageId, () => saved)
    },
    [conversationId, engine, messages, patchMessage, queryClient],
  )

  const remove = useCallback(
    async (messageId: string) => {
      await api.delete(`/api/chat/messages/${messageId}`)
      patchMessage(messageId, (m) => ({ ...m, body: '', deletedAt: new Date().toISOString(), refs: [], reactions: [] }))
    },
    [patchMessage],
  )

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string, meId: string) => {
      const message = messages.find((m) => m.id === messageId)
      if (!message) return
      const mine = message.reactions.some((r) => r.emoji === emoji && r.userIds.includes(meId))
      const optimistic = (reactions: ChatReaction[]): ChatReaction[] => {
        if (mine) {
          return reactions
            .map((r) => (r.emoji === emoji ? { ...r, userIds: r.userIds.filter((id) => id !== meId) } : r))
            .filter((r) => r.userIds.length > 0)
        }
        return reactions.some((r) => r.emoji === emoji)
          ? reactions.map((r) => (r.emoji === emoji ? { ...r, userIds: [...r.userIds, meId] } : r))
          : [...reactions, { emoji, userIds: [meId] }]
      }
      const before = message.reactions
      patchMessage(messageId, (m) => ({ ...m, reactions: optimistic(m.reactions) }))
      const path = `/api/chat/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`
      try {
        const { reactions } = mine ? await api.delete<{ reactions: ChatReaction[] }>(path) : await api.put<{ reactions: ChatReaction[] }>(path, {})
        patchMessage(messageId, (m) => ({ ...m, reactions }))
      } catch (err) {
        patchMessage(messageId, (m) => ({ ...m, reactions: before }))
        throw err
      }
    },
    [messages, patchMessage],
  )

  return {
    messages,
    pending,
    hasMore,
    hasNewer,
    detached: detached !== null,
    arrivedWhileDetached,
    receipts: live?.receipts ?? [],
    openedReadId: openedReadId ?? null,
    loadOlder,
    loadNewer,
    isLoadingOlder: loading === 'older',
    isLoadingNewer: loading === 'newer',
    isJumping: loading === 'jump',
    jumpTo,
    returnToLatest,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error as Error | null,
    refetch: query.refetch,
    send,
    retry,
    discard,
    edit,
    remove,
    toggleReaction,
  }
}
