// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { E2EProvider } from './crypto/E2EProvider'
import { ChatStreamProvider } from '@/shared/components/chat/ChatStreamProvider'
import { RefCard } from '@/shared/components/entity-cards/RefCard'
import { ME_QUERY_KEY } from '@/shared/hooks/use-me'
import { linkFor, parseDashLink } from '@/shared/lib/entity-links'
import type { ChatConversation, ChatEncrypted, ChatMessage, ChatMessageRef, RefType, SessionPayload } from '@/shared/lib/types'
import { JumpToBottom } from './JumpToBottom'
import { ThreadView } from './ThreadView'

// The thread after the Mesaje sprint: the "New" line, reactions, the quote that jumps, the card
// of an object the reader cannot open, and the links that cards and pasted URLs go through.

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// A stand-in engine: "encrypting" is base64 of the JSON, so the test can read what would travel.
const { fakeEngine } = vi.hoisted(() => {
  const fakeEngine = {
    currentStatus: 'ready',
    encrypt: vi.fn(),
    decrypt: vi.fn(),
    decryptedIn: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    approvals: [],
    changedKeys: new Set<string>(),
  }
  return { fakeEngine }
})

// useDecrypted / useDecryptedRows read the context inside E2EProvider.tsx, so mocking `useE2E` would
// not reach them: the real provider runs, on top of a stand-in engine and stubbed browser crypto.
vi.mock('./crypto/engine', async (original) => ({
  ...(await original<typeof import('./crypto/engine')>()),
  E2EEngine: class {
    currentStatus = fakeEngine.currentStatus
    init = async () => 'ready'
    syncToDevice = async () => {}
    forgetDevices = () => {}
    subscribe = fakeEngine.subscribe
    encrypt = fakeEngine.encrypt
    decrypt = fakeEngine.decrypt
    decryptedIn = fakeEngine.decryptedIn
    approvals = fakeEngine.approvals
    changedKeys = fakeEngine.changedKeys
  },
}))
vi.mock('./crypto/primitives', async (original) => ({
  ...(await original<typeof import('./crypto/primitives')>()),
  isSupported: () => true,
  hasEd25519: async () => true,
}))
vi.mock('./crypto/store', () => ({ openCryptoStore: async () => ({}) }))

const me = 'u1'
const ana = 'a1'
const ID = '0b6f4a52-7f43-4c1e-9d55-0d4b7c1a2e33'

describe('entity links', () => {
  const types: RefType[] = ['prospect', 'invoice', 'email_thread', 'calendar_event', 'archive_file', 'note']

  it.each(types)('%s: linkFor and parseDashLink go both ways', (type) => {
    const link = linkFor(type, ID, { date: '2026-11-03', folderId: 'f1' })
    expect(parseDashLink(link)).toEqual({ type, id: ID })
    expect(parseDashLink(`${window.location.origin}${link}`)).toEqual({ type, id: ID })
  })

  it('a link to another site or without an id is not an object', () => {
    expect(parseDashLink(`https://example.com/notes?note=${ID}`)).toBeNull()
    expect(parseDashLink('/notes?note=abc')).toBeNull()
    expect(parseDashLink('/calendar?date=2026-11-03')).toBeNull()
  })
})

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'm0',
    conversationId: 'c1',
    authorUserId: ana,
    authorName: 'Ana',
    body: '',
    encrypted: null,
    clientId: crypto.randomUUID(),
    createdAt: '2026-11-03T08:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    attachments: [],
    replyTo: null,
    reactions: [],
    refs: [],
    ...overrides,
  }
}

const conversation: ChatConversation = {
  id: 'c1',
  kind: 'dm',
  name: null,
  members: [
    { id: me, displayName: 'Ion', email: 'ion@example.com', presence: 'online', lastSeenAt: null },
    { id: ana, displayName: 'Ana', email: 'ana@example.com', presence: 'online', lastSeenAt: null },
  ],
  lastMessage: null,
  unreadCount: 2,
  muted: false,
  canManage: false,
}

let container: HTMLDivElement
let root: Root
let queryClient: QueryClient
let page: { messages: ChatMessage[]; lastReadMessageId: string | null }

beforeEach(() => {
  fakeEngine.encrypt.mockReset().mockImplementation(async (_c: string, _m: string[], content: unknown) => ({
    v: 1,
    ciphertext: btoa(JSON.stringify(content)),
    senderDeviceId: 'device-1',
  }))
  fakeEngine.decrypt
    .mockReset()
    .mockImplementation(async (m: { encrypted: { ciphertext: string } }) => ({ status: 'ok', content: JSON.parse(atob(m.encrypted.ciphertext)) }))
  fakeEngine.decryptedIn.mockReset().mockResolvedValue([])
  const session = {
    user: { id: me, email: 'ion@example.com', displayName: 'Ion', role: null, status: 'active' as const },
    features: ['mesaje.view'],
    isPlatformAdmin: false,
    mailboxes: [],
    notificationPrefs: { chat: 'all' as const, emailNew: true, alerts: true },
    navLayout: null,
    updatesSeenAt: null,
    locale: 'ro',
    enabledLocales: ['ro'],
    displayCurrency: 'RON',
    displayCurrencies: ['RON', 'EUR', 'USD'],
  } satisfies SessionPayload
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(ME_QUERY_KEY, session)

  vi.stubGlobal(
    'EventSource',
    class {
      readyState = 1
      addEventListener() {}
      close() {}
    },
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'POST' && url.includes('/messages')) {
        const sent = JSON.parse(init.body!) as { clientId: string; encrypted: ChatEncrypted }
        const saved = message({ id: 'm-sent', authorUserId: me, authorName: 'Ion', clientId: sent.clientId, encrypted: sent.encrypted })
        return { ok: true, status: 200, json: async () => ({ success: true, data: saved }) }
      }
      const data = url.includes('/messages') ? { ...page, hasMore: false, hasNewer: false, receipts: [] } : null
      return { ok: true, status: 200, json: async () => ({ success: true, data }) }
    }),
  )

  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function renderThread(url = '/') {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[url]}>
          <ChatStreamProvider>
            <E2EProvider>
              <ThreadView conversation={conversation} meId={me} />
            </E2EProvider>
          </ChatStreamProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
  // The query resolves on the next ticks.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

describe('ThreadView', () => {
  it('draws the "New" line before the first message from someone else since the last visit', async () => {
    page = {
      lastReadMessageId: 'm1',
      messages: [
        message({ id: 'm1', authorUserId: me, authorName: 'Ion', body: 'salut' }),
        message({ id: 'm2', body: 'unu', createdAt: '2026-11-03T08:01:00.000Z' }),
        message({ id: 'm3', body: 'doi', createdAt: '2026-11-03T08:02:00.000Z' }),
      ],
    }
    await renderThread()
    const line = container.querySelector('[role="separator"]')
    expect(line?.textContent).toBe('2 mesaje noi')
    // Right before m2.
    expect(line?.nextElementSibling?.getAttribute('data-message-id')).toBe('m2')
  })

  it('my reaction is pressed, someone else\'s is not', async () => {
    page = {
      lastReadMessageId: 'm2',
      messages: [
        message({
          id: 'm2',
          body: 'ok?',
          reactions: [
            { emoji: '👍', userIds: [me] },
            { emoji: '❤️', userIds: [ana] },
          ],
        }),
      ],
    }
    await renderThread()
    const pills = [...container.querySelectorAll<HTMLButtonElement>('.reaction-pill button')]
    expect(pills.map((pill) => pill.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
  })

  it('clicking a quote jumps to the quoted message and lights it up', async () => {
    page = {
      lastReadMessageId: 'm3',
      messages: [
        message({ id: 'm2', body: 'intrebarea' }),
        message({
          id: 'm3',
          authorUserId: me,
          authorName: 'Ion',
          body: 'raspunsul',
          createdAt: '2026-11-03T08:02:00.000Z',
          replyTo: { id: 'm2', authorUserId: ana, authorName: 'Ana', body: 'intrebarea', encrypted: null, hasAttachment: false, deleted: false },
        }),
      ],
    }
    await renderThread()
    const quote = container.querySelector<HTMLButtonElement>('[data-message-id="m3"] button[aria-label*="Ana"]')
    expect(quote).not.toBeNull()
    await act(async () => {
      quote!.click()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(container.querySelector('[data-message-id="m2"]')?.classList.contains('msg-highlight')).toBe(true)
  })
})

describe('ThreadView, end-to-end', () => {
  it('sends an empty body and the ciphertext, then shows the saved message decrypted', async () => {
    page = { lastReadMessageId: null, messages: [] }
    queryClient.setQueryData(['chat', 'conversations'], [conversation])
    await renderThread()
    const field = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Mesaj"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'salut')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Trimite"]')!.click()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(fakeEngine.encrypt).toHaveBeenCalledWith('c1', [me, ana], { body: 'salut', attachments: [] })
    const post = vi.mocked(fetch).mock.calls.find(([url, init]) => (init as { method?: string } | undefined)?.method === 'POST' && String(url).endsWith('/messages'))!
    const sent = JSON.parse((post[1] as { body: string }).body)
    expect(sent.body).toBe('')
    expect(sent.encrypted).toMatchObject({ v: 1, senderDeviceId: 'device-1' })
    expect(JSON.stringify(sent)).not.toContain('salut')
    await settle()
    expect(container.querySelector('[data-message-id="m-sent"]')?.textContent).toContain('salut')
  })

  it('a message the device has no key for says it is waiting for the key', async () => {
    fakeEngine.decrypt.mockResolvedValue({ status: 'missing-key' })
    page = {
      lastReadMessageId: 'm1',
      messages: [message({ id: 'm1', encrypted: { v: 1, ciphertext: btoa('x'), senderDeviceId: 'device-2' } })],
    }
    await renderThread()
    await settle()
    expect(container.querySelector('[data-message-id="m1"]')?.textContent).toContain('Se așteaptă cheia mesajului…')
  })

  it('searches locally through what the engine decrypted, not on the server', async () => {
    fakeEngine.decryptedIn.mockResolvedValue([
      { messageId: 'm1', conversationId: 'c1', authorUserId: ana, createdAt: '2026-11-03T08:00:00.000Z', body: 'cumpar zmeura', attachments: [] },
      { messageId: 'm2', conversationId: 'c1', authorUserId: ana, createdAt: '2026-11-03T08:01:00.000Z', body: 'altceva', attachments: [] },
    ])
    page = { lastReadMessageId: null, messages: [] }
    await renderThread('/?panel=search')
    const input = document.querySelector<HTMLInputElement>('input[type="search"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'zmeură')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 400))
    })
    await settle()
    expect(fakeEngine.decryptedIn).toHaveBeenCalledWith('c1')
    const results = document.querySelector('ul.divide-y')?.textContent ?? ''
    expect(results).toContain('zmeura')
    expect(results).not.toContain('altceva')
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/search'))).toBe(false)
  })
})

describe('RefCard', () => {
  it('an object the reader cannot open shows the title, "no access" and the way to ask', async () => {
    const refItem: ChatMessageRef = { id: 'r1', type: 'prospect', refId: null, state: 'denied', canOpen: false, card: { title: 'Acme SRL' } }
    const onRequestAccess = vi.fn()
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <RefCard refItem={refItem} onRequestAccess={onRequestAccess} />
          </MemoryRouter>
        </QueryClientProvider>,
      )
    })
    expect(container.textContent).toContain('Acme SRL')
    expect(container.textContent).toContain('N-ai acces')
    expect(container.querySelector('a')).toBeNull()
    act(() => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Cere acces')!.click())
    expect(onRequestAccess).toHaveBeenCalledWith(refItem)
  })
})

describe('JumpToBottom', () => {
  it('shows how many messages came in meanwhile', () => {
    act(() => root.render(<JumpToBottom count={3} onClick={() => {}} />))
    expect(container.textContent).toContain('3')
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('Mergi jos, 3 mesaje noi')
  })
})

describe('fileKind', () => {
  it('reads the extension first, the content type second', async () => {
    const { fileKind } = await import('@/shared/components/FileTypeIcon')
    expect(fileKind('anexa.pdf', 'application/octet-stream')).toBe('pdf')
    expect(fileKind('raport.XLSX')).toBe('sheet')
    expect(fileKind('10-2026.zip')).toBe('archive')
    expect(fileKind('contract.docx')).toBe('doc')
    expect(fileKind('fara-extensie', 'application/pdf')).toBe('pdf')
    expect(fileKind('fara-extensie', 'video/mp4')).toBe('video')
    expect(fileKind('ceva.bin')).toBe('other')
  })
})
