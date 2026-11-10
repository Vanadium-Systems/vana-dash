// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextStep } from './NextStep'
import type { ProspectSheet } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/shared/hooks/use-me', () => ({ useMe: () => ({ session: { user: { id: 'u1' } } }) }))
vi.mock('../tasks/CompleteTaskDialog', () => ({ CompleteTaskDialog: ({ task }: { task: { id: string } | null }) => (task ? <div data-testid="complete-dialog">{task.id}</div> : null) }))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const DAY = 24 * 60 * 60 * 1000
const task = (dueAt: string, assigneeUserId = 'u2') => ({ id: 't1', kind: 'call', title: 'Sună Acme', dueAt, assigneeUserId, assigneeName: 'Ana' })
const sheet = (overrides: Partial<ProspectSheet>) => ({ id: 'p1', name: 'Acme SRL', canEdit: true, nextTask: null, ...overrides }) as ProspectSheet

describe('NextStep', () => {
  it('with no open task shows the warning band and "Programează" calls onSchedule', () => {
    const onSchedule = vi.fn()
    act(() => root.render(<NextStep sheet={sheet({})} onSchedule={onSchedule} />))
    expect(container.textContent).toContain('Niciun pas următor')
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Programează'))!
    act(() => button.click())
    expect(onSchedule).toHaveBeenCalledOnce()
  })

  it('without edit rights the band has no schedule button', () => {
    act(() => root.render(<NextStep sheet={sheet({ canEdit: false })} onSchedule={() => {}} />))
    expect(container.textContent).toContain('Niciun pas următor')
    expect(container.querySelector('button')).toBeNull()
  })

  it('shows the task, its assignee, and ticking it opens the completion dialog', () => {
    act(() => root.render(<NextStep sheet={sheet({ nextTask: task(new Date(Date.now() + DAY).toISOString()) } as Partial<ProspectSheet>)} onSchedule={() => {}} />))
    expect(container.textContent).toContain('Sună Acme')
    expect(container.textContent).toContain('Ana')
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(checkbox.getAttribute('aria-label')).toBe('Marchează „Sună Acme” ca făcut')
    act(() => checkbox.click())
    expect(container.querySelector('[data-testid="complete-dialog"]')?.textContent).toBe('t1')
  })

  it('an overdue task is flagged, a future one is not', () => {
    act(() => root.render(<NextStep sheet={sheet({ nextTask: task(new Date(Date.now() - DAY).toISOString()) } as Partial<ProspectSheet>)} onSchedule={() => {}} />))
    expect(container.querySelector('.text-destructive-text')).not.toBeNull()
    act(() => root.render(<NextStep sheet={sheet({ nextTask: task(new Date(Date.now() + DAY).toISOString()) } as Partial<ProspectSheet>)} onSchedule={() => {}} />))
    expect(container.querySelector('.text-destructive-text')).toBeNull()
  })

  it('the tick is disabled for someone who neither edits the prospect nor owns the task', () => {
    act(() => root.render(<NextStep sheet={sheet({ canEdit: false, nextTask: task(new Date(Date.now() + DAY).toISOString(), 'u2') } as Partial<ProspectSheet>)} onSchedule={() => {}} />))
    expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(true)
    act(() => root.render(<NextStep sheet={sheet({ canEdit: false, nextTask: task(new Date(Date.now() + DAY).toISOString(), 'u1') } as Partial<ProspectSheet>)} onSchedule={() => {}} />))
    expect((container.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(false)
  })
})
