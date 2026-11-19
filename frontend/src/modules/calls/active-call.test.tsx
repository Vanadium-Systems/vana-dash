// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ActiveCallProvider, useActiveCall } from './ActiveCall'

const mounts = vi.fn()
vi.mock('./LiveKitRoomView', () => ({
  LiveKitRoomView: ({ compact }: { compact?: boolean }) => {
    useEffect(() => mounts(), [])
    return <div data-testid="room" data-compact={String(Boolean(compact))} />
  },
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  mounts.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function CallPage() {
  const call = useActiveCall()
  useEffect(() => {
    if (!call.session) call.start({ id: 'c1', backTarget: '/calls', room: { livekitUrl: 'wss://x', token: 't', e2eeKey: 'k', kind: 'video', title: 'Acme', onLeave: () => {} } })
  }, [call])
  return <div ref={call.setSlot} />
}

it('the room stays connected when the person leaves the call page, as a floating window', () => {
  const render = (onCallPage: boolean) =>
    act(() =>
      root.render(
        <MemoryRouter>
          <ActiveCallProvider>{onCallPage ? <CallPage /> : <p>other page</p>}</ActiveCallProvider>
        </MemoryRouter>,
      ),
    )
  render(true)
  expect(document.querySelector('[data-testid="room"]')?.getAttribute('data-compact')).toBe('false')
  render(false)
  expect(document.querySelector('[data-testid="room"]')?.getAttribute('data-compact')).toBe('true')
  render(true)
  expect(document.querySelector('[data-testid="room"]')?.getAttribute('data-compact')).toBe('false')
  expect(mounts).toHaveBeenCalledTimes(1)
})
