// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StageBar } from './StageBar'
import type { ProspectSheet } from './types'
import type { ProspectStatusEntry } from '@/shared/lib/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const patch = vi.hoisted(() => vi.fn())
vi.mock('@/shared/lib/api', () => ({ api: { patch } }))
vi.mock('./use-sheet', () => ({ useWrite: () => (run: () => Promise<unknown>) => run() }))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  patch.mockReset()
  patch.mockResolvedValue({})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

const status = (key: string, label: string, sortOrder: number, kind: ProspectStatusEntry['kind'] = 'open'): ProspectStatusEntry => ({ id: `s-${key}`, key, label, colorToken: 'blue' as ProspectStatusEntry['colorToken'], sortOrder, isDefault: false, kind })
const STATUSES = [status('new', 'Nou', 1), status('contacted', 'Contactat', 2), status('offer', 'Ofertă', 3), status('won', 'Câștigat', 4, 'won'), status('lost', 'Pierdut', 5, 'lost')]

const sheet = (overrides: Partial<ProspectSheet> = {}) => ({ id: 'p1', name: 'Acme SRL', status: 'contacted', daysInStage: 3, canEdit: true, lostReason: null, ...overrides }) as ProspectSheet

const render = (value: ProspectSheet) => act(() => root.render(<StageBar sheet={value} statuses={STATUSES} />))
const stageButtons = () => [...container.querySelectorAll<HTMLButtonElement>('[role="group"] button')]
const buttonByText = (text: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement

describe('StageBar', () => {
  it('lists the open stages in order and marks only the current one', () => {
    render(sheet())
    expect(stageButtons().map((b) => b.textContent)).toEqual(['Nou', 'Contactat', 'Ofertă'])
    expect(stageButtons().map((b) => b.getAttribute('aria-current'))).toEqual([null, 'step', null])
    expect(container.textContent).toContain('3 zile în etapă')
  })

  it('moves to another stage with one PATCH and ignores a press on the current one', () => {
    render(sheet())
    act(() => stageButtons()[2]!.click())
    expect(patch).toHaveBeenCalledWith('/api/prospects/p1', { status: 'offer' })
    patch.mockClear()
    act(() => stageButtons()[1]!.click())
    expect(patch).not.toHaveBeenCalled()
  })

  it('"Câștigat" moves straight to the won status', () => {
    render(sheet())
    act(() => buttonByText('Câștigat').click())
    expect(patch).toHaveBeenCalledWith('/api/prospects/p1', { status: 'won' })
  })

  it('"Pierdut" asks for a reason first and sends it with the lost status', () => {
    render(sheet())
    act(() => buttonByText('Pierdut').click())
    expect(patch).not.toHaveBeenCalled()
    const textarea = document.body.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea).not.toBeNull()
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(textarea, '  Prea scump  ')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => (document.body.querySelector('form') as HTMLFormElement).requestSubmit())
    expect(patch).toHaveBeenCalledWith('/api/prospects/p1', { status: 'lost', lostReason: 'Prea scump' })
  })

  it('a closed prospect shows its status and the reason, and "Redeschide" goes back to the first stage', () => {
    render(sheet({ status: 'lost', lostReason: 'Prea scump' }))
    expect(stageButtons()).toHaveLength(0)
    expect(container.textContent).toContain('Pierdut')
    expect(container.textContent).toContain('Prea scump')
    act(() => buttonByText('Redeschide').click())
    expect(patch).toHaveBeenCalledWith('/api/prospects/p1', { status: 'new', lostReason: null })
  })

  it('without edit rights the stages are disabled and the exits are absent', () => {
    render(sheet({ canEdit: false }))
    expect(stageButtons().every((b) => b.disabled)).toBe(true)
    expect(container.textContent).not.toContain('Câștigat')
    expect(container.textContent).not.toContain('Redeschide')
  })
})
