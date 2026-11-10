// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviewStep } from './PreviewStep'
import type { ImportPreview, PreviewRow } from './types'
import type { ProspectAssignee } from '@/shared/lib/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const me = vi.hoisted(() => ({ assign: true }))
vi.mock('@/shared/hooks/use-me', () => ({ useMe: () => ({ can: () => me.assign }) }))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  // The table measures itself for the column fit; jsdom has no ResizeObserver.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  me.assign = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

const rows: PreviewRow[] = [
  { line: 2, action: 'new', name: 'Acme SRL', fills: [] },
  { line: 3, action: 'new', name: 'Beta SRL', fills: [] },
  { line: 4, action: 'update', name: 'Gamma SRL', fills: ['cif', 'website'], ownerName: 'Ana' },
  { line: 5, action: 'error', name: 'Delta SRL', fills: [], error: 'cif_invalid' },
  { line: 6, action: 'skip', name: 'Acme SRL', fills: [], reason: 'duplicate_in_file' },
]
const preview = (counts: Partial<ImportPreview['counts']> = {}, list = rows): ImportPreview => ({ token: 'tok', counts: { new: 2, update: 1, error: 1, skip: 1, ...counts }, rows: list })
const assignees = [{ id: 'u1', displayName: 'Ana', email: 'ana@example.com' }, { id: 'u2', displayName: null, email: 'ion@example.com' }] as ProspectAssignee[]

function render(value: ImportPreview, handlers: { onBack?: () => void; onCommit?: (d: unknown) => void } = {}) {
  act(() => root.render(<PreviewStep preview={value} assignees={assignees} onBack={handlers.onBack ?? (() => {})} onCommit={handlers.onCommit ?? (() => {})} />))
}
const tab = (name: string) => [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((el) => el.textContent?.startsWith(name))!
const select = (el: HTMLElement) =>
  act(() => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
    el.click()
  })
const startButton = () => [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Importă')) as HTMLButtonElement
const bodyRows = () => [...container.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td:nth-child(2)')?.textContent ?? '')

describe('import preview', () => {
  it('summarizes the counts and shows one tab per action, with "Sărite" only when there are skips', () => {
    render(preview())
    expect(container.textContent).toContain('2 noi · 1 completează existenți · 1 cu erori')
    expect([...container.querySelectorAll('[role="tab"]')].map((el) => el.textContent)).toEqual(['Noi · 2', 'Completează · 1', 'Erori · 1', 'Sărite · 1'])
    render(preview({ skip: 0 }, rows.filter((r) => r.action !== 'skip')))
    expect([...container.querySelectorAll('[role="tab"]')].map((el) => el.textContent)).toEqual(['Noi · 2', 'Completează · 1', 'Erori · 1'])
  })

  it('opens on the new rows and switching tabs lists only the rows of that action', () => {
    render(preview())
    expect(bodyRows()).toHaveLength(2)
    expect(bodyRows()[0]).toContain('Acme SRL')
    expect(bodyRows()[1]).toContain('Beta SRL')
    select(tab('Completează'))
    expect(bodyRows()[0]).toContain('Gamma SRL')
    expect(bodyRows()[0]).toContain('Completează: CUI, site')
    expect(bodyRows()[0]).toContain('rămâne al lui Ana')
    select(tab('Erori'))
    expect(bodyRows()).toHaveLength(1)
    expect(bodyRows()[0]).toContain('Delta SRL')
    select(tab('Sărite'))
    expect(bodyRows()).toHaveLength(1)
  })

  it('starts on "Completează" when nothing is new', () => {
    render(preview({ new: 0 }, rows.filter((r) => r.action !== 'new')))
    expect(tab('Completează').getAttribute('data-state')).toBe('active')
  })

  it('an empty tab says so', () => {
    render(preview({ error: 0 }, rows.filter((r) => r.action !== 'error')))
    select(tab('Erori'))
    expect(container.textContent).toContain('Niciun rând aici.')
  })

  it('the start button counts new plus updated rows and commits to the importer himself by default', () => {
    const onCommit = vi.fn()
    render(preview(), { onCommit })
    expect(startButton().textContent).toBe('Importă 3 rânduri')
    act(() => startButton().click())
    expect(onCommit).toHaveBeenCalledWith({ mode: 'me' })
  })

  it('with nothing to write the start button is disabled and a warning explains', () => {
    render(preview({ new: 0, update: 0 }, rows.filter((r) => r.action === 'error')))
    expect(startButton().disabled).toBe(true)
    expect(container.textContent).toContain('Nu e nimic de importat din fișierul ăsta.')
  })

  it('without the right to assign, the rows go to the importer and the mode picker is absent', () => {
    me.assign = false
    render(preview())
    expect(container.textContent).not.toContain('Cum se împart')
    expect(container.querySelectorAll('select, [role="combobox"]')).toHaveLength(0)
  })

  it('"Alt fișier" goes back', () => {
    const onBack = vi.fn()
    render(preview(), { onBack })
    act(() => ([...container.querySelectorAll('button')].find((b) => b.textContent === 'Alt fișier') as HTMLButtonElement).click())
    expect(onBack).toHaveBeenCalledOnce()
  })
})
