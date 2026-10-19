import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { useChatStream } from '@/shared/components/chat/ChatStreamProvider'
import { api } from '@/shared/lib/api'
import type { ChatAttachment, ChatMessage, ChatReceipt } from '@/shared/lib/types'

// Firul unei conversații (PLAN.md C3). Starea e locală, nu un query: mesajul optimist, cel
// „netrimis" și paginile vechi încărcate manual nu au loc într-un cache de query, iar lista
// primită de pe server rămâne sursa pentru restul (recărcare la deschiderea firului).
//
// Serverul are deja dedupe pe `clientId` (mesaj optimist + conexiune lentă), deci retrimiterea
// e sigură: al doilea POST întoarce același mesaj, nu o copie.

export interface PendingMessage {
  clientId: string
  body: string
  attachments: ChatAttachment[]
  createdAt: string
  status: 'sending' | 'failed'
  error: string | null
}

export interface SendInput {
  body: string
  attachments: ChatAttachment[]
}

const PAGE_SIZE = 50

type ThreadPage = { messages: ChatMessage[]; hasMore: boolean; receipts: ChatReceipt[] }

/** Moves a member's receipt forward, never back; members not in the list are the viewer. */
function advanceReceipt(receipts: ChatReceipt[], userId: string, field: 'deliveredUpTo' | 'readUpTo', at: string): ChatReceipt[] {
  return receipts.map((r) => (r.userId === userId && (!r[field] || Date.parse(r[field]!) < Date.parse(at)) ? { ...r, [field]: at } : r))
}

export function useThreadMessages(conversationId: string | undefined) {
  const queryClient = useQueryClient()
  const { subscribe } = useChatStream()
  const [older, setOlder] = useState<ChatMessage[]>([])
  const [pending, setPending] = useState<PendingMessage[]>([])
  const queryKey = ['chat', 'messages', conversationId ?? ''] as const

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const data = await api.get<ThreadPage>(
        `/api/chat/conversations/${conversationId}/messages?limit=${PAGE_SIZE}`,
      )
      return data
    },
    enabled: Boolean(conversationId),
    staleTime: 10_000,
  })

  // Filul schimbat → lista veche și mesajele optimiste ale vechiului fir nu mai sunt ale lui.
  useEffect(() => {
    setOlder([])
    setPending([])
  }, [conversationId])

  useEffect(
    () =>
      subscribe((event) => {
        if (!conversationId) return
        if (event.type === 'message.created' && event.conversationId === conversationId) {
          // Optimistul rămâne până vine răspunsul POST-ului, care aduce id-ul real; dedupe pe
          // clientId, ca mesajul să nu apară de două ori.
          queryClient.setQueryData<ThreadPage>(queryKey, (current) =>
            current && !current.messages.some((m) => m.id === event.message.id || m.clientId === event.message.clientId)
              ? { ...current, messages: [...current.messages, event.message] }
              : current,
          )
        }
        if (event.type === 'read' && event.conversationId === conversationId) {
          queryClient.setQueryData<ThreadPage>(queryKey, (current) => {
            const read = current?.messages.find((m) => m.id === event.messageId)
            return current && read ? { ...current, receipts: advanceReceipt(current.receipts, event.userId, 'readUpTo', read.createdAt) } : current
          })
        }
        if (event.type === 'delivered' && event.conversationId === conversationId) {
          queryClient.setQueryData<ThreadPage>(queryKey, (current) =>
            current ? { ...current, receipts: advanceReceipt(current.receipts, event.userId, 'deliveredUpTo', event.at) } : current,
          )
        }
        if (event.type === 'message.updated' && event.conversationId === conversationId) {
          queryClient.setQueryData<ThreadPage>(queryKey, (current) =>
            current
              ? { ...current, messages: current.messages.map((m) => (m.id === event.message.id ? { ...m, ...event.message } : m)) }
              : current,
          )
        }
      }),
    [conversationId, queryClient, queryKey, subscribe],
  )

  const send = useCallback(
    async (input: SendInput): Promise<void> => {
      if (!conversationId) return
      const clientId = crypto.randomUUID()
      const optimistic: PendingMessage = {
        clientId,
        body: input.body,
        attachments: input.attachments,
        createdAt: new Date().toISOString(),
        status: 'sending',
        error: null,
      }
      setPending((current) => [...current, optimistic])

      const payload = {
        body: input.body,
        clientId,
        attachmentIds: input.attachments.map((a) => a.id),
      }
      try {
        const saved = await api.post<ChatMessage>(`/api/chat/conversations/${conversationId}/messages`, payload)
        setPending((current) => current.filter((m) => m.clientId !== clientId))
        queryClient.setQueryData<ThreadPage>(queryKey, (current) =>
          current && !current.messages.some((m) => m.id === saved.id || m.clientId === clientId)
            ? { ...current, messages: [...current.messages, saved] }
            : current,
        )
        void queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] })
      } catch (err) {
        // Rămâne în fir, cu „Netrimis · Reîncearcă" — nu un toast care dispare (fișa de design).
        setPending((current) =>
          current.map((m) => (m.clientId === clientId ? { ...m, status: 'failed', error: err instanceof Error ? err.message : String(err) } : m)),
        )
      }
    },
    [conversationId, queryClient, queryKey],
  )

  const retry = useCallback(
    async (clientId: string) => {
      const failed = pending.find((m) => m.clientId === clientId)
      if (!failed) return
      setPending((current) => current.map((m) => (m.clientId === clientId ? { ...m, status: 'sending', error: null } : m)))
      await send({ body: failed.body, attachments: failed.attachments })
    },
    [pending, send],
  )

  const discard = useCallback((clientId: string) => {
    setPending((current) => current.filter((m) => m.clientId !== clientId))
  }, [])

  const loadOlder = useCallback(async () => {
    const oldest = query.data?.messages[0]
    if (!conversationId || !oldest) return
    const page = await api.get<ThreadPage>(
      `/api/chat/conversations/${conversationId}/messages?before=${oldest.id}&limit=${PAGE_SIZE}`,
    )
    setOlder((current) => [...page.messages, ...current])
  }, [conversationId, query.data?.messages])

  const edit = useCallback(
    async (messageId: string, body: string) => {
      if (!conversationId) return
      const saved = await api.patch<ChatMessage>(`/api/chat/messages/${messageId}`, { body })
      queryClient.setQueryData<ThreadPage>(queryKey, (current) =>
        current
          ? { ...current, messages: current.messages.map((m) => (m.id === messageId ? saved : m)) }
          : current,
      )
    },
    [conversationId, queryClient, queryKey],
  )

  const remove = useCallback(
    async (messageId: string) => {
      if (!conversationId) return
      await api.delete(`/api/chat/messages/${messageId}`)
      queryClient.setQueryData<ThreadPage>(queryKey, (current) =>
        current
          ? { ...current, messages: current.messages.map((m) => (m.id === messageId ? { ...m, body: '', deletedAt: new Date().toISOString() } : m)) }
          : current,
      )
    },
    [conversationId, queryClient, queryKey],
  )

  const [loadingOlder, setLoadingOlder] = useState(false)
  return {
    messages: [...older, ...(query.data?.messages ?? [])],
    pending,
    hasMore: query.data?.hasMore ?? false,
    receipts: query.data?.receipts ?? [],
    loadOlder: async () => {
      if (loadingOlder) return
      setLoadingOlder(true)
      try {
        await loadOlder()
      } finally {
        setLoadingOlder(false)
      }
    },
    isLoadingOlder: loadingOlder,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error as Error | null,
    refetch: query.refetch,
    send,
    retry,
    discard,
    edit,
    remove,
  }
}