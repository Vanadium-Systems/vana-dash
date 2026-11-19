import { api } from '@/shared/lib/api'
import type { ChatMessage, ChatReceipt } from '@/shared/lib/types'

export const PAGE_SIZE = 50

export type ThreadPage = {
  messages: ChatMessage[]
  hasMore: boolean
  hasNewer: boolean
  receipts: ChatReceipt[]
  lastReadMessageId: string | null
}

export function threadQueryKey(conversationId: string) {
  return ['chat', 'messages', conversationId] as const
}

/** The latest page of a conversation: the open thread and the warm-up at start share it. */
export function threadQueryOptions(conversationId: string) {
  return {
    queryKey: threadQueryKey(conversationId),
    queryFn: () => api.get<ThreadPage>(`/api/chat/conversations/${conversationId}/messages?limit=${PAGE_SIZE}`),
    staleTime: 10_000,
    // Kept for the whole tab: switching conversations shows the last page at once and refreshes it behind.
    gcTime: Infinity,
  }
}
