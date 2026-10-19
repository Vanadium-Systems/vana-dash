import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import type { ChatStreamEvent } from '@/shared/lib/types'

// Fluxul de mesaje al omului (PLAN.md C3, RES din Wave 5): o singură conexiune SSE per tab,
// comună tuturor conversațiilor, ținută în AppLayout ca să nu se reia la fiecare navigare.
//
// De ce starea e un context, nu un query: evenimentele sunt o sursă externă, nu date pe care
// le interogăm. Serverul reține conexiunea cât timp socketul e viu și trimite `message.created`
// etc. către toate conversațiile omului; fiecare pagină abonează ce îi trebuie.

export type ChatStreamStatus = 'off' | 'connecting' | 'live'

const EVENT_TYPES = ['message.created', 'message.updated', 'conversation.updated', 'read', 'delivered', 'presence'] as const

/** La 45s, sub pragul de 90s din presence.ts — un timer strimuit într-un tab ascuns nu ajunge
 *  să numere drept „online", iar serverul trece omul în „away" și îi trimite push. */
const HEARTBEAT_MS = 45_000

interface ChatStreamValue {
  status: ChatStreamStatus
  subscribe: (handler: (event: ChatStreamEvent) => void) => () => void
}

const ChatStreamContext = createContext<ChatStreamValue | null>(null)

export function ChatStreamProvider({ children }: { children: ReactNode }) {
  const { can } = useMe()
  const enabled = can('mesaje.view')
  const [status, setStatus] = useState<ChatStreamStatus>('off')
  const handlers = useRef(new Set<(event: ChatStreamEvent) => void>())

  const subscribe = useCallback((handler: (event: ChatStreamEvent) => void) => {
    handlers.current.add(handler)
    return () => {
      handlers.current.delete(handler)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    let source: EventSource | null = null
    let heartbeat: number | null = null

    const emit = (event: ChatStreamEvent) => {
      for (const handler of handlers.current) handler(event)
    }

    const open = () => {
      if (document.visibilityState === 'hidden') return
      if (source) return
      setStatus('connecting')
      // `retry: 5000` vine de la server: browserul reconectează singur, fără să încercăm
      // să construim un alt `EventSource` la fiecare blip de rețea.
      const stream = new EventSource('/api/chat/stream')
      source = stream
      for (const type of EVENT_TYPES) {
        stream.addEventListener(type, (raw) => {
          setStatus('live')
          try {
            emit(JSON.parse((raw as MessageEvent).data) as ChatStreamEvent)
          } catch {
            // Eveniment malformat — îl ignorăm, nu pentru asta pică streamul.
          }
        })
      }
      stream.onopen = () => setStatus('live')
      stream.onerror = () => {
        // readyState 2 = închis definitiv (403 după ce rolul i-a fost schimbat). Nu reintra
        // în buclă de reîncercare — poarta `mesaje.view` se verifică înainte de a deschide.
        setStatus(stream.readyState === 2 ? 'off' : 'connecting')
      }
      heartbeat = window.setInterval(() => {
        void api.post('/api/chat/heartbeat', {}).catch(() => undefined)
      }, HEARTBEAT_MS)
    }

    const close = () => {
      source?.close()
      source = null
      if (heartbeat !== null) window.clearInterval(heartbeat)
      heartbeat = null
      setStatus('off')
    }

    const onVisibility = () => (document.visibilityState === 'hidden' ? close() : open())

    open()
    document.addEventListener('visibilitychange', onVisibility)
    // Pe Android, WebView-ul ține socketul „deschis" în background fără să livreze nimic — de
    // aceea streamul se închide la `hidden`, iar serverul trece omul în „away" după 30s.
    // Revenirea redeschide; `offline` (push nu e în joc aici) e acoperit de reconectarea
    // automată a lui EventSource.
    window.addEventListener('online', open)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', open)
      close()
      handlers.current.clear()
    }
  }, [enabled])

  const value = useMemo<ChatStreamValue>(() => ({ status, subscribe }), [status, subscribe])
  return <ChatStreamContext.Provider value={value}>{children}</ChatStreamContext.Provider>
}

/**
 * Abonare la evenimentele de mesaje. `useSyncExternalStore`-ul nu e nevoie: handler-ele se
 * citesc într-un `Set` și fiecare pagină își face propriul `setState` în ei.
 */
export function useChatStream(): ChatStreamValue {
  const value = useContext(ChatStreamContext)
  if (!value) throw new Error('useChatStream must be used inside ChatStreamProvider')
  return value
}