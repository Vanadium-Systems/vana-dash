// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeXhr } from './fake-xhr'
import { VoiceUploadPanel } from './VoiceUploadPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class FakeAudio {
  duration = 42
  preload = ''
  onloadedmetadata: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(_value: string) {
    queueMicrotask(() => this.onloadedmetadata?.())
  }
}

const NOTE = { id: 'v1', durationSeconds: 42 }

let container: HTMLDivElement
let root: Root
const RealXhr = globalThis.XMLHttpRequest
const RealAudio = globalThis.Audio

beforeEach(() => {
  FakeXhr.all = []
  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest
  globalThis.Audio = FakeAudio as unknown as typeof Audio
  URL.createObjectURL = () => 'blob:test'
  URL.revokeObjectURL = () => {}
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <VoiceUploadPanel prospectId="p1" onClose={() => {}} />
      </QueryClientProvider>,
    ),
  )
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  globalThis.XMLHttpRequest = RealXhr
  globalThis.Audio = RealAudio
})

const file = (name: string, size = 1000) => new File([new Uint8Array(size)], name, { type: 'audio/mpeg' })
const flush = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))))
const pick = async (...files: File[]) => {
  const input = container.querySelector<HTMLInputElement>('[data-testid="voice-file-input"]')!
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await flush()
}
const text = () => container.textContent ?? ''
const row = (name: string) => [...container.querySelectorAll('li')].find((li) => li.textContent?.includes(name))!

describe('VoiceUploadPanel', () => {
  it('accepts several audio files at once', () => {
    const input = container.querySelector<HTMLInputElement>('[data-testid="voice-file-input"]')!
    expect(input.multiple).toBe(true)
    expect(input.accept).toBe('audio/*')
  })

  it('uploads one file at a time, carries on after a failure, and retries the failed one', async () => {
    await pick(file('a.mp3'), file('b.mp3'), file('c.mp3'))
    expect(FakeXhr.all).toHaveLength(1)
    // The server reads the fields first, so the duration goes before the file.
    expect([...FakeXhr.all[0]!.sent!.keys()]).toEqual(['durationSeconds', 'file'])
    expect(FakeXhr.all[0]!.sent!.get('durationSeconds')).toBe('42')

    FakeXhr.all[0]!.progress(500, 1000)
    await flush()
    expect(row('a.mp3').textContent).toContain('50%')
    expect(row('b.mp3').textContent).toContain('În așteptare')

    await act(async () => FakeXhr.all[0]!.finish(201, { success: true, data: NOTE }))
    await flush()
    expect(FakeXhr.all).toHaveLength(2)
    await act(async () => FakeXhr.all[1]!.finish(415, { success: false, error: 'Fișierul nu e audio.', code: 'VOICE_UNSUPPORTED' }))
    await flush()
    // The failure of b.mp3 does not stop c.mp3.
    expect(FakeXhr.all).toHaveLength(3)
    expect(row('b.mp3').textContent).toContain('Fișierul nu e audio.')
    await act(async () => FakeXhr.all[2]!.finish(201, { success: true, data: NOTE }))
    await flush()
    expect(row('c.mp3').textContent).toContain('Încărcat')

    const retry = [...row('b.mp3').querySelectorAll('button')].find((button) => button.textContent?.includes('Reîncearcă'))!
    await act(async () => retry.click())
    await flush()
    expect(FakeXhr.all).toHaveLength(4)
    await act(async () => FakeXhr.all[3]!.finish(201, { success: true, data: NOTE }))
    await flush()
    expect(row('b.mp3').textContent).toContain('Încărcat')
  })

  it('rejects a file over 25 MB in the queue without sending it', async () => {
    await pick(file('mare.wav', 26 * 1024 * 1024), file('mic.mp3'))
    expect(row('mare.wav').textContent).toContain('depășește')
    expect(row('mare.wav').textContent).not.toContain('Reîncearcă')
    // Only the small file went out.
    expect(FakeXhr.all).toHaveLength(1)
    expect(FakeXhr.all[0]!.sent!.get('file')).toHaveProperty('name', 'mic.mp3')
    expect(text()).toContain('depășește 25.0 MB')
  })
})
