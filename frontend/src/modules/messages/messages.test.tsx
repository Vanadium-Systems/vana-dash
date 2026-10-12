// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatStreamProvider, useChatStream } from '@/shared/components/chat/ChatStreamProvider'
import { ME_QUERY_KEY } from '@/shared/hooks/use-me'
import { CHAT_CONVERSATIONS_KEY, useChatUnreadTotal } from '@/shared/hooks/use-chat'
import { conversationTitle, presenceLabel } from './ConversationList'
import type { ChatConversation, SessionPayload } from '@/shared/lib/types'

// Listă, prezență și necitate — plus faptul că streamul e singurul sursă de actualizare: un
// eveniment de prezență se aplică pe cache, fără refetch (refetch-ul ar fi o cerere la fiecare
// conectare/deconectare a unui coleg).

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const me = 'u1'
const ana = 'a1'

function conversation(overrides: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id: 'c1',
    kind: 'dm',
    name: null,
    members: [
      { id: me, displayName: 'Ion', email: 'ion@vanadium.systems', presence: 'online', lastSeenAt: null },
      { id: ana, displayName: 'Ana', email: 'ana@vanadium.systems', presence: 'online', lastSeenAt: null },
    ],
    lastMessage: null,
    unreadCount: 0,
    muted: false,
    ...overrides,
  }
}

describe('conversationTitle', () => {
  it('la DM e numele celuilalt om, nu al meu', () => {
    expect(conversationTitle(conversation(), me)).toBe('Ana')
  })

  it('la grup e numele grupului', () => {
    expect(conversationTitle(conversation({ kind: 'group', name: 'Vânzări' }), me)).toBe('Vânzări')
  })
})

describe('presenceLabel', () => {
  it('„Activ acum" e text, nu doar un punct colorat', () => {
    expect(presenceLabel('online', null)).toBe('Activ acum')
  })

  it('absența arată când a fost văzut ultima dată', () => {
    const label = presenceLabel('away', new Date(Date.now() - 2 * 3600_000).toISOString())
    expect(label).toMatch(/^Văzut acum/)
  })

  it('fără semn de viață spune asta, nu minte că a fost activ', () => {
    expect(presenceLabel('away', null)).toBe('necunoscut când a fost activ')
  })
})

let container: HTMLDivElement
let root: Root
let queryClient: QueryClient
let source: { listeners: Record<string, (event: MessageEvent) => void>; emit: (type: string, data: unknown) => void }

function render() {
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ChatStreamProvider>
            <UnreadProbe />
          </ChatStreamProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  )
}

function UnreadProbe() {
  const total = useChatUnreadTotal()
  return <p data-testid="unread">{total}</p>
}

beforeEach(() => {
  const session = {
    user: { id: me, email: 'ion@vanadium.systems', displayName: 'Ion', role: null, status: 'active' as const },
    features: ['mesaje.view'],
    isPlatformAdmin: false,
    mailboxes: ['sales'],
    notificationPrefs: { chat: 'all' as const, emailNew: true, alerts: true },
    navLayout: null,
    updatesSeenAt: null,
  } satisfies SessionPayload
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(ME_QUERY_KEY, session)
  queryClient.setQueryData(CHAT_CONVERSATIONS_KEY, [
    conversation({ unreadCount: 2 }),
    conversation({ id: 'c2', kind: 'group', name: 'Vânzări', unreadCount: 3 }),
  ])

  source = {
    listeners: {},
    emit: (type, data) => source.listeners[type]?.({ data: JSON.stringify(data) } as MessageEvent),
  }
  vi.stubGlobal(
    'EventSource',
    class {
      readyState = 1
      onopen: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor() {
        this.onopen?.()
      }
      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        source.listeners[type] = listener
      }
      close() {
        this.readyState = 2
      }
    },
  )
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: null }) }))

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('useChatUnreadTotal', () => {
  it('adună necitatele din toate conversațiile', () => {
    render()
    expect(container.querySelector('[data-testid="unread"]')!.textContent).toBe('5')
  })

  it('evenimentul de prezență se aplică pe cache, fără cerere nouă', () => {
    render()
    const before = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls.length
    act(() => source.emit('presence', { type: 'presence', userId: ana, presence: 'away', lastSeenAt: null }))
    const cached = queryClient.getQueryData<ChatConversation[]>(CHAT_CONVERSATIONS_KEY)!
    expect(cached[0]!.members.find((m) => m.id === ana)!.presence).toBe('away')
    expect((vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before)
  })

  it('mesajul nou invalidează lista, pentru că necitatele depind și de citirile celorlalți', () => {
    render()
    act(() => void queryClient.invalidateQueries({ queryKey: CHAT_CONVERSATIONS_KEY }))
    act(() => source.emit('conversation.updated', { conversationId: 'c1' }))
    expect(queryClient.getQueryState(CHAT_CONVERSATIONS_KEY)?.isInvalidated).toBe(true)
  })
})

describe('ChatStreamProvider', () => {
  it('deschide o singură conexiune pentru toate conversațiile', () => {
    render()
    expect(source.listeners['message.created']).toBeTypeOf('function')
    expect(source.listeners.presence).toBeTypeOf('function')
  })

  it('fără mesaje.view nu deschide deloc fluxul', () => {
    queryClient.setQueryData(ME_QUERY_KEY, {
      user: { id: me, email: 'ion@vanadium.systems', displayName: 'Ion', role: null, status: 'active' },
      features: [],
      isPlatformAdmin: false,
      mailboxes: [],
      notificationPrefs: { chat: 'none', emailNew: true, alerts: true },
      navLayout: null,
      updatesSeenAt: null,
    } satisfies SessionPayload)
    render()
    expect(source.listeners['message.created']).toBeUndefined()
  })

  it('abonații primesc evenimentele', () => {
    const seen: unknown[] = []
    act(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <ChatStreamProvider>
            <Subscriber onEvent={(event) => seen.push(event)} />
          </ChatStreamProvider>
        </QueryClientProvider>,
      ),
    )
    act(() => source.emit('message.created', { type: 'message.created', conversationId: 'c1', message: { id: 'm1' } }))
    expect(seen).toHaveLength(1)
  })
})

function Subscriber({ onEvent }: { onEvent: (event: unknown) => void }) {
  const { subscribe } = useChatStream()
  useEffect(() => subscribe((event) => onEvent(event)), [subscribe, onEvent])
  return null
}