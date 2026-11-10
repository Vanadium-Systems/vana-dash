// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmProvider } from '@/shared/components/ui/confirm-dialog'
import { MeetDialog } from './MeetDialog'
import { meetingOf, type MeetingTask } from './meet-api'
import { useMeetingControls } from './use-meeting-controls'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({
  features: new Set<string>(),
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  track: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('@/shared/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/shared/lib/api')>()), api: { get: h.get, post: h.post, patch: h.patch, delete: h.del } }))
vi.mock('@/shared/hooks/use-me', () => ({
  useMe: () => ({ session: { user: { id: 'u1', email: 'me@example.com', displayName: 'Ana Pop' } }, can: (feature: string) => h.features.has(feature) }),
}))
vi.mock('@/modules/email/compose/send-flow', () => ({ trackScheduledSend: h.track }))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: h.toastError }) }))

const sheetData = {
  id: 'p1',
  name: 'Acme SRL',
  people: [
    { id: 'a', name: 'Maria', role: null, isDecisionMaker: false, doNotContact: false, doNotContactReason: null, position: 0 },
    { id: 'b', name: 'Radu', role: null, isDecisionMaker: false, doNotContact: true, doNotContactReason: 'a cerut', position: 1 },
  ],
  contactPoints: [
    { id: 'c1', personId: 'a', kind: 'email', value: 'maria@example.com', label: null, isPrimary: true, status: 'ok' },
    { id: 'c2', personId: 'b', kind: 'email', value: 'radu@example.com', label: null, isPrimary: false, status: 'ok' },
    { id: 'c3', personId: 'a', kind: 'phone', value: '0700000000', label: null, isPrimary: false, status: 'ok' },
  ],
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  h.features = new Set(['calendar.view'])
  for (const mock of [h.get, h.post, h.patch, h.del, h.track, h.toastError]) mock.mockReset()
  h.get.mockImplementation(async (url: string) => {
    if (url === '/api/prospects/p1') return sheetData
    if (url === '/api/prospects/assignees') return [{ id: 'u1', displayName: 'Ana Pop', email: 'me@example.com' }, { id: 'u2', displayName: 'Dan Ionescu', email: 'dan@example.com' }]
    if (url === '/api/email/sender-options') return { identities: [{ key: 'sales', label: 'Vânzări', fromAddress: 'sales@example.com' }], signatures: {}, logoUrl: null, autoLoadImages: false }
    if (url.includes('/invite.ics')) return { filename: 'invitatie.ics', content: 'QkVHSU4=', uid: 't1@vanadash', sequence: 1 }
    throw new Error(`unexpected GET ${url}`)
  })
  h.post.mockImplementation(async (url: string) => (url === '/api/email/send' ? { sendId: 's1', sendAfter: new Date().toISOString() } : { id: 't1' }))
  h.patch.mockResolvedValue({})
  h.del.mockResolvedValue(undefined)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

const flush = async () => {
  for (let i = 0; i < 4; i++) await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))))
}

const wrap = (node: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>
      <ConfirmProvider>{node}</ConfirmProvider>
    </MemoryRouter>
  </QueryClientProvider>
)

const button = (text: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined
const checkboxOf = (text: string) => [...document.body.querySelectorAll('label')].find((l) => l.textContent?.includes(text))?.querySelector('input[type="checkbox"]') as HTMLInputElement | undefined
const click = async (el: HTMLElement | undefined) => {
  expect(el).toBeDefined()
  await act(async () => el!.click())
  await flush()
}
const typeInto = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function openCreate() {
  await act(async () => root.render(wrap(<MeetDialog prospectId="p1" prospectName="Acme SRL" task={null} open onOpenChange={() => {}} />)))
  await flush()
}

const taskPosts = () => h.post.mock.calls.filter(([url]) => url === '/api/prospects/p1/tasks')
const sendPosts = () => h.post.mock.calls.filter(([url]) => url === '/api/email/send')

describe('MeetDialog, new meeting', () => {
  it('without an invitation makes one POST and sends nothing', async () => {
    await openCreate()
    expect((document.body.querySelector('input[maxlength="255"]') as HTMLInputElement).value).toBe('Întâlnire cu Acme SRL')
    await click(button('Programează'))
    expect(taskPosts()).toHaveLength(1)
    expect(taskPosts()[0]![1]).toMatchObject({ kind: 'meeting', title: 'Întâlnire cu Acme SRL', durationMinutes: 30, invitees: [], addToCalendar: true })
    expect(sendPosts()).toHaveLength(0)
    expect(h.get.mock.calls.some(([url]) => String(url).includes('invite.ics'))).toBe(false)
  })

  it('with an invitation: task, then the .ics, then the send with the attachment and the mailbox', async () => {
    h.features.add('email.trimitere')
    await openCreate()
    await click(checkboxOf('Maria'))
    await click(button('Programează și trimite'))
    expect(taskPosts()[0]![1]).toMatchObject({ invitees: ['maria@example.com'] })
    expect(h.get).toHaveBeenCalledWith('/api/prospects/p1/tasks/t1/invite.ics?method=request&from=sales')
    expect(sendPosts()).toHaveLength(1)
    expect(sendPosts()[0]![1]).toMatchObject({ from: 'sales', to: ['maria@example.com'], attachments: [{ filename: 'invitatie.ics', content: 'QkVHSU4=' }] })
    expect((sendPosts()[0]![1] as { subject: string }).subject).toBe('Invitație: Întâlnire cu Acme SRL')
    expect(h.track).toHaveBeenCalledOnce()
  })

  it('a do-not-contact person is disabled and shows the reason', async () => {
    await openCreate()
    const radu = checkboxOf('Radu')!
    expect(radu.disabled).toBe(true)
    expect(document.body.textContent).toContain('Nu contacta: a cerut')
    expect(checkboxOf('Maria')!.disabled).toBe(false)
  })

  it('shows the colleagues picker only with calendar.comune', async () => {
    await openCreate()
    expect(document.body.textContent).not.toContain('Colegi invitați')
    h.features.add('calendar.comune')
    await openCreate()
    expect(document.body.textContent).toContain('Colegi invitați')
    expect(checkboxOf('Dan Ionescu')).toBeDefined()
    expect(checkboxOf('Ana Pop')).toBeUndefined()
    await click(checkboxOf('Dan Ionescu'))
    await click(button('Programează'))
    expect(taskPosts()[0]![1]).toMatchObject({ attendeeUserIds: ['u2'] })
  })

  it('without email.trimitere there is no invitation toggle, only the reason', async () => {
    await openCreate()
    expect(checkboxOf('Trimite invitația')).toBeUndefined()
    expect(document.body.textContent).toContain('Nu ai dreptul să trimiți emailuri')
    expect(h.get.mock.calls.some(([url]) => url === '/api/email/sender-options')).toBe(false)
  })

  it('when the email fails the meeting stays and the toast offers a retry', async () => {
    h.features.add('email.trimitere')
    h.post.mockImplementation(async (url: string) => {
      if (url === '/api/email/send') throw new Error('SMTP jos')
      return { id: 't1' }
    })
    await openCreate()
    await click(checkboxOf('Maria'))
    await click(button('Programează și trimite'))
    expect(taskPosts()).toHaveLength(1)
    expect(h.toastError).toHaveBeenCalledOnce()
    const [message, options] = h.toastError.mock.calls[0]! as [string, { action: { label: string; onClick: () => void } }]
    expect(message).toContain('Întâlnirea e salvată, dar invitația nu a plecat: SMTP jos')
    expect(options.action.label).toBe('Încearcă din nou')
    await act(async () => options.action.onClick())
    await flush()
    expect(sendPosts()).toHaveLength(2)
    expect(taskPosts()).toHaveLength(1)
  })
})

const meeting: MeetingTask = meetingOf(
  { id: 't1', title: 'Întâlnire cu Acme SRL', description: null, dueAt: '2026-11-20T08:00:00.000Z', durationMinutes: 30, location: null, invitees: ['maria@example.com'], attendeeUserIds: [] },
  'p1',
  'Acme SRL',
)

function Row() {
  const controls = useMeetingControls()
  return (
    <div>
      <button onClick={() => controls.move(meeting)}>muta-rand</button>
      <button onClick={() => void controls.cancel(meeting)}>anuleaza-rand</button>
      {controls.dialogs}
    </div>
  )
}

describe('meeting row actions', () => {
  beforeEach(() => h.features.add('email.trimitere'))

  it('move: saves, asks, and sends the updated invitation', async () => {
    await act(async () => root.render(wrap(<Row />)))
    await click(button('muta-rand'))
    expect(document.body.textContent).toContain('Mută întâlnirea')
    await typeInto(document.body.querySelector('input[maxlength="500"]') as HTMLInputElement, 'Sala 2')
    await click(button('Salvează'))
    expect(h.patch).toHaveBeenCalledOnce()
    expect(h.patch.mock.calls[0]![0]).toBe('/api/prospects/p1/tasks/t1')
    expect(h.patch.mock.calls[0]![1]).toMatchObject({ location: 'Sala 2', durationMinutes: 30 })
    expect(h.patch.mock.calls[0]![1]).not.toHaveProperty('invitees')
    expect(document.body.textContent).toContain('Trimit actualizarea către 1 invitat?')
    expect(sendPosts()).toHaveLength(0)
    await click(button('Trimite actualizarea'))
    expect(h.get).toHaveBeenCalledWith('/api/prospects/p1/tasks/t1/invite.ics?method=request&from=sales')
    expect(sendPosts()[0]![1]).toMatchObject({ from: 'sales', to: ['maria@example.com'], subject: 'Actualizare: Întâlnire cu Acme SRL' })
  })

  it('move with nothing changed does not ask', async () => {
    await act(async () => root.render(wrap(<Row />)))
    await click(button('muta-rand'))
    await click(button('Salvează'))
    expect(h.patch).toHaveBeenCalledOnce()
    expect(document.body.textContent).not.toContain('Trimit actualizarea')
  })

  it('cancel: confirms, deletes, asks, and sends method=cancel', async () => {
    await act(async () => root.render(wrap(<Row />)))
    await click(button('anuleaza-rand'))
    await click(button('Anulează întâlnirea'))
    expect(h.del).toHaveBeenCalledWith('/api/prospects/p1/tasks/t1')
    expect(document.body.textContent).toContain('Trimit anularea către 1 invitat?')
    await click(button('Trimite anularea'))
    expect(h.get).toHaveBeenCalledWith('/api/prospects/p1/tasks/t1/invite.ics?method=cancel&from=sales')
    expect(sendPosts()[0]![1]).toMatchObject({ from: 'sales', to: ['maria@example.com'], subject: 'Anulat: Întâlnire cu Acme SRL' })
  })

  it('cancel without the right to send does not ask', async () => {
    h.features.delete('email.trimitere')
    await act(async () => root.render(wrap(<Row />)))
    await click(button('anuleaza-rand'))
    await click(button('Anulează întâlnirea'))
    expect(h.del).toHaveBeenCalledOnce()
    expect(document.body.textContent).not.toContain('Trimit anularea')
  })
})
