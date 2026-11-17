// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmProvider } from '@/shared/components/ui/confirm-dialog'
import { RefCard } from '@/shared/components/entity-cards/RefCard'
import type { ChatMessageRef } from '@/shared/lib/types'
import {
  buildPublicCallUrl,
  extractKeyFromHash,
  generateCallKey,
  getCallKey,
  parseCallKeyFromInput,
  saveCallKey,
} from './call-keys'
import { LiveKitRoomView } from './LiveKitRoomView'
import { NewCallDialog } from './NewCallDialog'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
  connect: vi.fn(),
  isE2EESupported: vi.fn(() => false),
  writeText: vi.fn(async () => undefined),
}))

vi.mock('@/shared/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/api')>()),
  api: { get: h.get, post: h.post },
}))
vi.mock('@/shared/hooks/use-me', () => ({
  useMe: () => ({
    session: { user: { id: 'u1', email: 'me@example.com', displayName: 'Ana Pop' } },
    can: (feature: string) => feature === 'apeluri.manage' || feature === 'clienti.toti',
  }),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))
vi.mock('livekit-client/e2ee-worker?worker', () => ({ default: class MockWorker {} }))
vi.mock('livekit-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('livekit-client')>()
  return {
    ...actual,
    isE2EESupported: h.isE2EESupported,
    Room: class MockRoom {
      on() {
        return this
      }
      off() {
        return this
      }
      connect = h.connect
      disconnect = vi.fn(async () => undefined)
      setE2EEEnabled = vi.fn(async () => undefined)
      localParticipant = {
        identity: 'u1',
        name: 'Ana Pop',
        isMicrophoneEnabled: false,
        isCameraEnabled: false,
        isScreenShareEnabled: false,
        setMicrophoneEnabled: vi.fn(async () => undefined),
        setCameraEnabled: vi.fn(async () => undefined),
        setScreenShareEnabled: vi.fn(async () => undefined),
        videoTrackPublications: new Map(),
      }
      remoteParticipants = new Map()
    },
  }
})

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  window.localStorage.clear()
  h.post.mockReset()
  h.get.mockReset()
  h.connect.mockReset()
  h.isE2EESupported.mockReturnValue(false)
  h.writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: h.writeText },
  })
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function wrap(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ConfirmProvider>{ui}</ConfirmProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{`${loc.pathname}${loc.hash}`}</div>
}

describe('call-keys', () => {
  it('generates URL-safe key, builds and parses #k= URL fragments, and persists by call id', () => {
    const key = generateCallKey()
    expect(key.length).toBeGreaterThanOrEqual(32)
    expect(key).not.toMatch(/[+/=]/)

    const link = buildPublicCallUrl('https://dash.example.com/apel/abcDEF123456', key)
    expect(link).toBe(`https://dash.example.com/apel/abcDEF123456#k=${key}`)
    expect(extractKeyFromHash(`#k=${key}`)).toBe(key)
    expect(parseCallKeyFromInput(link)).toBe(key)
    expect(parseCallKeyFromInput(key)).toBe(key)

    saveCallKey('call-1', key)
    expect(getCallKey('call-1')).toBe(key)
  })
})

describe('NewCallDialog', () => {
  it('prefills prospect title, posts kind without room key to API, and copies link with #k= fragment', async () => {
    h.post.mockResolvedValue({
      id: 'call-lk-1',
      title: 'Apel cu Acme SRL',
      publicUrl: 'https://dash.example.com/apel/tok1234567890123',
      kind: 'audio',
      provider: 'livekit',
      status: 'open',
      scheduledAt: null,
      expiresAt: new Date(Date.now() + 4 * 3_600_000).toISOString(),
      durationSeconds: null,
      participantCount: null,
      prospect: { id: 'p1', name: 'Acme SRL' },
      billingClient: null,
      bookingId: null,
      conversationId: null,
    })

    const onCreated = vi.fn()
    await act(async () => {
      root.render(
        wrap(
          <NewCallDialog
            open
            onOpenChange={() => undefined}
            prospect={{ id: 'p1', name: 'Acme SRL' }}
            onCreated={onCreated}
          />,
        ),
      )
    })

    const titleInput = document.body.querySelector('input[type="text"], input:not([type])') as HTMLInputElement
    const expectedTitle = titleInput.value
    expect(expectedTitle).toContain('Acme SRL')

    const audioTab = [...document.body.querySelectorAll('[role="tab"]')].find((el) =>
      /^(Doar audio|Audio only)$/i.test(el.textContent?.trim() ?? ''),
    ) as HTMLButtonElement | undefined
    expect(audioTab).toBeDefined()
    await act(async () => {
      audioTab!.click()
    })

    const submitBtn = document.body.querySelector('button[type="submit"]') as HTMLButtonElement
    await act(async () => {
      submitBtn.click()
    })

    expect(h.post).toHaveBeenCalledTimes(1)
    const [path, body] = h.post.mock.calls[0]!
    expect(path).toBe('/api/calls')
    expect(body).toMatchObject({ title: expectedTitle, kind: 'audio', prospectId: 'p1' })
    expect(JSON.stringify(body)).not.toContain('key')

    const createdUrl = onCreated.mock.calls[0]![1] as string
    expect(createdUrl).toMatch(/^https:\/\/dash\.example\.com\/apel\/tok1234567890123#k=[A-Za-z0-9_-]{32,}$/)
    expect(getCallKey('call-lk-1')).toBeTruthy()
  })
})

describe('RefCard call card', () => {
  it('renders open call with Join action carrying #k= hash and hides button when ended', async () => {
    const openRef: ChatMessageRef = {
      id: 'mr1',
      type: 'call',
      refId: 'call-msg-1',
      state: 'snapshot',
      canOpen: true,
      card: { title: 'Sync Acme', kind: 'video', status: 'open' },
    }
    const endedRef: ChatMessageRef = {
      ...openRef,
      id: 'mr2',
      refId: 'call-msg-2',
      card: { title: 'Sync Acme', kind: 'audio', status: 'ended', durationSeconds: 180 },
    }

    await act(async () => {
      root.render(
        wrap(
          <>
            <RefCard refItem={openRef} callKey="test-room-key-123456" />
            <RefCard refItem={endedRef} callKey="test-room-key-123456" />
            <LocationProbe />
          </>,
        ),
      )
    })

    const joinButtons = [...container.querySelectorAll('button')].filter((b) =>
      b.textContent?.match(/Intră|Join/),
    )
    expect(joinButtons).toHaveLength(1)

    await act(async () => {
      joinButtons[0]!.click()
    })

    const loc = container.querySelector('[data-testid="location"]')?.textContent
    expect(loc).toBe('/calls/call-msg-1#k=test-room-key-123456')
    expect(getCallKey('call-msg-1')).toBe('test-room-key-123456')
  })
})

describe('LiveKitRoomView fail-closed E2EE', () => {
  it('blocks room connection when browser lacks WebRTC E2EE support', async () => {
    h.isE2EESupported.mockReturnValue(false)
    await act(async () => {
      root.render(
        wrap(
          <LiveKitRoomView
            livekitUrl="wss://acme.livekit.cloud"
            token="header.payload.sig"
            e2eeKey="test-room-key-123456"
            kind="video"
            title="Sync Acme"
            onLeave={() => undefined}
          />,
        ),
      )
    })

    expect(h.connect).not.toHaveBeenCalled()
    expect(container.textContent).toContain('E2EE')
  })
})
