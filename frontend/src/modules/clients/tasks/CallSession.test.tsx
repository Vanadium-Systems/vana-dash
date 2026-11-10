// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CallSession } from './CallSession'
import type { TaskRow } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const post = vi.hoisted(() => vi.fn())
vi.mock('@/shared/lib/api', () => ({ api: { post } }))

const tasks = vi.hoisted(() => ({ rows: [] as unknown[] }))
vi.mock('./use-tasks-data', () => ({ useTaskList: () => ({ isPending: false, data: { rows: tasks.rows } }) }))
vi.mock('./SnippetTextarea', () => ({ SnippetTextarea: (props: { value: string; onChange: (value: string) => void }) => <textarea data-testid="note" value={props.value} onChange={(e) => props.onChange(e.target.value)} /> }))

const SHEETS: Record<string, unknown> = {
  p1: { id: 'p1', name: 'Acme SRL', people: [], contactPoints: [{ id: 'cp1', personId: null, kind: 'phone', value: '0700 000 001', label: null, isPrimary: true, status: 'unknown' }] },
  p2: { id: 'p2', name: 'Beta SRL', people: [], contactPoints: [{ id: 'cp2', personId: null, kind: 'phone', value: '0700 000 002', label: null, isPrimary: true, status: 'unknown' }] },
}
vi.mock('../sheet/use-sheet', () => ({
  useSheet: (id: string) => ({ isPending: false, data: SHEETS[id] }),
  useTimeline: () => ({ data: { pages: [{ entries: [] }] } }),
  useNotes: () => ({ data: [] }),
  useSheetRefresh: () => () => {},
}))

let container: HTMLDivElement
let root: Root

const row = (id: string, prospectId: string, name: string): TaskRow => ({ id, prospectId, personId: null, assigneeUserId: 'u1', kind: 'call', title: `Sună ${name}`, description: null, dueAt: '2026-11-10T09:00:00Z', priority: 'medium', prospectName: name, personName: null, assigneeName: 'Ana' })

beforeEach(() => {
  post.mockReset()
  post.mockResolvedValue({})
  tasks.rows = [row('t1', 'p1', 'Acme SRL'), row('t2', 'p2', 'Beta SRL')]
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/clients/sesiune']}>
          <CallSession />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  )
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const press = async (key: string, init: KeyboardEventInit = {}) => {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  })
}
const heading = () => container.querySelector('main h2')?.textContent ?? ''
const queueLength = () => container.querySelectorAll('nav li').length

describe('CallSession', () => {
  it('starts on the first call task of the queue', () => {
    expect(heading()).toContain('Acme SRL')
    expect(queueLength()).toBe(2)
  })

  it('Enter without an outcome sends nothing', async () => {
    await press('Enter')
    expect(post).not.toHaveBeenCalled()
    expect(heading()).toContain('Acme SRL')
  })

  it('a digit picks the outcome and Enter sends it with the dialled number, then shows the next prospect', async () => {
    await press('2')
    await press('Enter')
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0]![0]).toBe('/api/prospects/tasks/t1/done')
    expect(post.mock.calls[0]![1]).toMatchObject({ outcome: 'no_answer' })
    expect(heading()).toContain('Beta SRL')
    expect(queueLength()).toBe(1)
  })

  it('"callback" suggests the follow-up in two days', async () => {
    await press('5')
    await press('Enter')
    const body = post.mock.calls[0]![1] as { outcome: string; nextTask?: { kind: string } }
    expect(body.outcome).toBe('callback')
    expect(body.nextTask?.kind).toBe('call')
  })

  it('wrong number sends the dialled contact point so the server can invalidate it', async () => {
    await press('4')
    await press('Enter')
    expect(post.mock.calls[0]![1]).toMatchObject({ outcome: 'wrong_number', contactPointId: 'cp1' })
  })

  it('Enter while typing in the note does not submit, Ctrl+Enter does', async () => {
    await press('1')
    const note = container.querySelector('[data-testid="note"]') as HTMLTextAreaElement
    await act(async () => {
      note.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    })
    expect(post).not.toHaveBeenCalled()
    await act(async () => {
      note.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }))
    })
    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0]![1]).toMatchObject({ outcome: 'answered' })
  })

  it('a failed save keeps the same prospect on screen', async () => {
    post.mockRejectedValueOnce(new Error('boom'))
    await press('1')
    await press('Enter')
    expect(heading()).toContain('Acme SRL')
    expect(queueLength()).toBe(2)
  })

  it('S moves the current task behind the rest and writes nothing', async () => {
    await press('s')
    expect(post).not.toHaveBeenCalled()
    expect(heading()).toContain('Beta SRL')
    expect(queueLength()).toBe(2)
  })

  it('Esc opens the summary with the tally of what was handled', async () => {
    await press('1')
    await press('Enter')
    await press('Escape')
    expect(container.textContent).toContain('Sumarul sesiunii')
    expect(container.textContent).toContain('1')
  })
})
