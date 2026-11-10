// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeXhr } from './fake-xhr'
import { VoiceRecorder } from './VoiceRecorder'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const trackStop = vi.fn()
const getUserMedia = vi.fn()

class FakeRecorder {
  static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus'
  static last: FakeRecorder | null = null
  state = 'inactive'
  mimeType: string
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  constructor(
    public stream: unknown,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? ''
    FakeRecorder.last = this
  }
  start() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob([new Uint8Array(10)], { type: this.mimeType }) })
    this.onstop?.()
  }
}

let container: HTMLDivElement
let root: Root
const RealXhr = globalThis.XMLHttpRequest
const RealRecorder = (globalThis as { MediaRecorder?: unknown }).MediaRecorder

const mount = () => {
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <VoiceRecorder prospectId="p1" taskId="task-1" onSaved={() => {}} />
      </QueryClientProvider>,
    ),
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  trackStop.mockReset()
  getUserMedia.mockReset()
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: trackStop }] })
  FakeXhr.all = []
  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest
  ;(globalThis as { MediaRecorder?: unknown }).MediaRecorder = FakeRecorder
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
  URL.createObjectURL = () => 'blob:take'
  URL.revokeObjectURL = () => {}
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
  globalThis.XMLHttpRequest = RealXhr
  ;(globalThis as { MediaRecorder?: unknown }).MediaRecorder = RealRecorder
})

const button = (label: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(label))
const text = () => container.textContent ?? ''
const startRecording = async () => {
  mount()
  await act(async () => button('Începe înregistrarea')!.click())
}
const advance = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)))

describe('VoiceRecorder', () => {
  it('says what the recording is for', () => {
    mount()
    expect(text()).toContain('Notă despre apel, nu înregistrarea apelului.')
  })

  it('counts with its own clock, stops on request and offers the take to listen to before saving', async () => {
    await startRecording()
    expect(FakeRecorder.last!.mimeType).toBe('audio/webm;codecs=opus')
    await advance(65_000)
    expect(container.querySelector('[data-testid="voice-timer"]')!.textContent).toBe('1:05')
    expect(text()).not.toContain('Se oprește singură')

    await act(async () => button('Oprește')!.click())
    expect(container.querySelector('audio')).not.toBeNull()
    expect(button('Salvează')).toBeDefined()
    expect(button('Renunță')).toBeDefined()
    expect(trackStop).toHaveBeenCalled()
  })

  it('warns from 14:00, stops by itself at 15:00 and saves exactly 900 seconds with the task', async () => {
    await startRecording()
    await advance(14 * 60_000)
    expect(text()).toContain('Se oprește singură la 15:00 (mai ai 1:00)')
    await advance(60_000)
    expect(FakeRecorder.last!.state).toBe('inactive')
    expect(text()).toContain('Am oprit înregistrarea la limita de 15:00')
    expect(container.querySelector('audio')).not.toBeNull()

    await act(async () => button('Salvează')!.click())
    const body = FakeXhr.all[0]!.sent!
    expect([...body.keys()]).toEqual(['durationSeconds', 'taskId', 'file'])
    expect(body.get('durationSeconds')).toBe('900')
    expect(body.get('taskId')).toBe('task-1')
  })

  it('explains a refused microphone and leaves the upload to the page', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    await startRecording()
    expect(text()).toContain('Accesul la microfon e blocat')
    expect(text()).toContain('încarcă un fișier')
    expect(button('Începe înregistrarea')).toBeDefined()
  })

  it('says so when there is no microphone or no MediaRecorder', async () => {
    getUserMedia.mockRejectedValue(new DOMException('none', 'NotFoundError'))
    await startRecording()
    expect(text()).toContain('Nu am găsit niciun microfon')

    act(() => root.unmount())
    root = createRoot(container)
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder
    await startRecording()
    expect(text()).toContain('Browserul acesta nu poate înregistra')
  })

  it('releases the microphone when it is closed mid-recording', async () => {
    await startRecording()
    act(() => root.unmount())
    expect(trackStop).toHaveBeenCalled()
    root = createRoot(container)
  })
})
