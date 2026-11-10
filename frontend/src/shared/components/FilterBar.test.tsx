// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FilterBar, useFilterState, type FilterClause, type FilterField } from './FilterBar'
import { parseClauses, serializeClauses } from '@/shared/lib/filters'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
  document.body.innerHTML = ''
})

const FIELDS: FilterField[] = [
  { key: 'status', label: 'Status', type: 'enum', options: [{ value: 'contacted', label: 'Contactat' }, { value: 'interested', label: 'Interesat' }, { value: 'lost', label: 'Pierdut' }] },
  { key: 'lastActivityAt', label: 'Ultima activitate', type: 'date' },
]

describe('useFilterState', () => {
  let state: { clauses: FilterClause[]; set: (next: FilterClause[]) => void }
  let url = ''

  function Probe() {
    const [clauses, set] = useFilterState()
    state = { clauses, set }
    url = useLocation().search
    return null
  }

  const mount = (initial: string) => act(() => root.render(<MemoryRouter initialEntries={[initial]}><Probe /></MemoryRouter>))

  it('scrie în ?f= și citește înapoi aceeași listă, fără să piardă alți parametri', () => {
    mount('/clients?tab=prospectare')
    const clauses: FilterClause[] = [
      { field: 'status', op: 'in', value: ['contacted', 'interested'] },
      { field: 'score', op: 'between', value: [10, null] },
      { field: 'lastActivityAt', op: 'is_empty' },
    ]
    act(() => state.set(clauses))
    expect(state.clauses).toEqual(clauses)
    expect(new URLSearchParams(url).get('tab')).toBe('prospectare')
    expect(new URLSearchParams(url).get('f')).toBe(serializeClauses(clauses))

    act(() => state.set([]))
    expect(state.clauses).toEqual([])
    expect(new URLSearchParams(url).has('f')).toBe(false)
    expect(new URLSearchParams(url).get('tab')).toBe('prospectare')
  })

  it('JSON invalid, formă greșită sau prea mare dă [] fără excepție', () => {
    for (const raw of ['{nu e json', '{"field":"status"}', '[{"field":"status","op":"in","value":[]}]', '[{"field":"x","op":"like","value":["a"]}]', JSON.stringify(Array.from({ length: 41 }, () => ({ field: 'a', op: 'is_empty' }))), `["${'a'.repeat(9000)}"]`]) {
      mount(`/clients?f=${encodeURIComponent(raw)}`)
      expect(state.clauses).toEqual([])
    }
    expect(parseClauses(null)).toEqual([])
  })
})

describe('FilterBar', () => {
  function render(clauses: FilterClause[], onChange = vi.fn()) {
    act(() => root.render(<FilterBar fields={FIELDS} clauses={clauses} onChange={onChange} search="" onSearch={() => {}} count={412} pinnedStorageKey="test.filters" />))
    return onChange
  }

  it('arată chip-ul cu etichetele valorilor, „nu” la not_in, și numărul formatat', () => {
    render([
      { field: 'status', op: 'in', value: ['contacted', 'interested'] },
      { field: 'status', op: 'not_in', value: ['lost'] },
    ])
    const text = container.textContent ?? ''
    expect(text).toContain('Status: Contactat, Interesat')
    expect(text).toContain('Status: nu Pierdut')
    expect(text).toContain('412')
  })

  it('× scoate doar clauza lui', () => {
    const onChange = render([
      { field: 'status', op: 'in', value: ['contacted'] },
      { field: 'lastActivityAt', op: 'is_empty' },
    ])
    const remove = container.querySelector('button[aria-label="Scoate filtrul Status: Contactat"]') as HTMLButtonElement
    act(() => remove.click())
    expect(onChange).toHaveBeenCalledWith([{ field: 'lastActivityAt', op: 'is_empty' }])
  })

  it('„Resetează” apare doar cu filtre active', () => {
    render([])
    expect(container.textContent).not.toContain('Resetează')
    render([{ field: 'status', op: 'in', value: ['lost'] }])
    expect(container.textContent).toContain('Resetează')
  })
})
