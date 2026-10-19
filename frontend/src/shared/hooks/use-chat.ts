import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useChatStream } from '@/shared/components/chat/ChatStreamProvider'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import type { ChatConversation, ChatStreamEvent } from '@/shared/lib/types'

// Conversațiile omului (PLAN.md C3). Un singur query, citit de lista din sidebar, de badge-ul
// din nav și de widget-ul de pe Azi — deci necitatele se văd la fel peste tot.
//
// Streamul nu e o interogare: evenamentele se aplică pe cache, nu pe un refetch. Prezența se
// aplică în loc (nu schimbă nimic în DB), iar mesajele/lecturile invalidă lista, care e ieftină
// și rămâne adevărată (numărul de necitite depinde și de citirile celorlalți membri).

export const CHAT_CONVERSATIONS_KEY = ['chat', 'conversations'] as const

export function useChatConversations() {
  const { can } = useMe()
  return useQuery({
    queryKey: CHAT_CONVERSATIONS_KEY,
    queryFn: () => api.get<ChatConversation[]>('/api/chat/conversations'),
    enabled: can('mesaje.view'),
    staleTime: 30_000,
  })
}

/** Lista conversațiilor, ținută la zi de stream. Perechea cu useChatConversations ca să nu
 *  fie nevoie de `useEffect` în fiecare pagină. */
export function useLiveChatConversations() {
  const query = useChatConversations()
  const queryClient = useQueryClient()
  const { subscribe } = useChatStream()

  useEffect(
    () =>
      subscribe((event: ChatStreamEvent) => {
        if (event.type === 'presence') {
          queryClient.setQueryData<ChatConversation[]>(CHAT_CONVERSATIONS_KEY, (conversations) =>
            conversations?.map((conversation) => ({
              ...conversation,
              members: conversation.members.map((member) =>
                member.id === event.userId
                  ? { ...member, presence: event.presence, lastSeenAt: event.lastSeenAt ?? member.lastSeenAt }
                  : member,
              ),
            })),
          )
          return
        }
        // Ticks live in the thread; the list has nothing to refetch for them.
        if (event.type === 'delivered') return
        void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY })
      }),
    [queryClient, subscribe],
  )

  return query
}

/** Totalul de necitite pentru badge-ul din nav. Suma din listă, nu un endpoint în plus — ar însemna
 *  încă o cerere la fiecare mesaj, pentru un număr pe care îl avem deja. */
export function useChatUnreadTotal(): number {
  const { can } = useMe()
  const conversations = useLiveChatConversations()
  return useMemo(() => (can('mesaje.view') ? (conversations.data ?? []).reduce((sum, c) => sum + c.unreadCount, 0) : 0), [can, conversations.data])
}