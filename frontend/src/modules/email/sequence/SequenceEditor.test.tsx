// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SequenceEditor } from './SequenceEditor'
import { emptyStep, parseBounceReason, stepIsComplete, stepsFromSequence, stepsPayload } from './steps'
import type { EmailSequence } from '@/shared/lib/types'
import { t } from '@/shared/lib/i18n'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }))
vi.mock('@/shared/lib/api', () => ({ api }))
vi.mock('@/shared/hooks/use-me', () => ({ useMe: () => ({ can: () => true }) }))
vi.mock('@/shared/components/ui/confirm-dialog', () => ({ useConfirm: () => async () => true }))
vi.mock('../IdentityField', () => ({ IdentityField: () => null, useIdentityKey: (initial: string) => [initial, () => {}, []] }))
vi.mock('./EnrollListDialog', () => ({ EnrollListDialog: () => null }))
vi.mock('./SequenceDiagnostics', () => ({ SequenceDiagnostics: () => null }))

// The DnD context is replaced so a test can drop one card on another without pointer events.
const dnd = vi.hoisted(() => ({ onDragEnd: null as null | ((event: { active: { id: string }; over: { id: string } | null }) => void) }))
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    DndContext: ({ children, onDragEnd }: { children: React.ReactNode; onDragEnd: typeof dnd.onDragEnd }) => {
      dnd.onDragEnd = onDragEnd
      return <>{children}</>
    },
  }
})

const TEMPLATES = [
  { id: 'tpl-a', name: 'Intro Acme' },
  { id: 'tpl-b', name: 'Follow-up Acme' },
]

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  api.get.mockReset()
  api.post.mockReset()
  api.patch.mockReset()
  api.get.mockImplementation(async (url: string) => (url === '/api/email/templates' ? TEMPLATES : { identities: [] }))
  api.post.mockResolvedValue({})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

const sequence = (): EmailSequence =>
  ({
    id: 's1',
    name: 'Acme outreach',
    active: false,
    pausedAt: null,
    fromIdentity: 'outreach',
    stopOnMeeting: true,
    stopOnWonLost: true,
    steps: [
      { kind: 'email', delayDays: 0, templateId: 'tpl-a', variantBTemplateId: null, taskTitle: null, taskDescription: null },
      { kind: 'call', delayDays: 2, templateId: null, variantBTemplateId: null, taskTitle: 'Call Acme', taskDescription: null },
      { kind: 'task', delayDays: 4, templateId: null, variantBTemplateId: null, taskTitle: 'Send brochure', taskDescription: null },
    ],
  }) as unknown as EmailSequence

const render = async (value: EmailSequence | null, onClose = vi.fn()) => {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <SequenceEditor sequence={value} onClose={onClose} />
      </QueryClientProvider>,
    )
  })
  // Let the queries settle so the editor has taken its baseline snapshot.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const select = (el: HTMLSelectElement, value: string) =>
  act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    setter.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement
const titleInputs = () => [...container.querySelectorAll<HTMLInputElement>('input[id$="-title"]')].map((i) => i.value)
const saveButton = () => button(t('common:actions.save'))

describe('SequenceEditor reordering', () => {
  it('dropping a step on another moves it and sends the new order on save', async () => {
    await render(sequence())
    expect(titleInputs()).toEqual(['Call Acme', 'Send brochure'])
    const uids = [...container.querySelectorAll<HTMLInputElement>('input[id$="-title"]')].map((i) => i.id.replace('-title', ''))
    // Last step dropped on the first one: it becomes the first.
    await act(async () => dnd.onDragEnd!({ active: { id: uids[1]! }, over: { id: uids[0]! } }))
    expect(titleInputs()).toEqual(['Send brochure', 'Call Acme'])
    await act(async () => saveButton().click())
    const [url, body] = api.patch.mock.calls[0]!
    expect(url).toBe('/api/email/sequences/s1')
    expect((body as { steps: Array<{ kind: string }> }).steps.map((s) => s.kind)).toEqual(['email', 'task', 'call'])
  })

  it('a drop outside the list or on itself keeps the order and the form stays unchanged', async () => {
    await render(sequence())
    const first = container.querySelector<HTMLInputElement>('input[id$="-title"]')!.id.replace('-title', '')
    await act(async () => dnd.onDragEnd!({ active: { id: first }, over: null }))
    await act(async () => dnd.onDragEnd!({ active: { id: first }, over: { id: first } }))
    expect(titleInputs()).toEqual(['Call Acme', 'Send brochure'])
    expect(saveButton().disabled).toBe(true)
  })

  it('removing a step is blocked when only one is left', async () => {
    await render(null)
    const remove = () => container.querySelector<HTMLButtonElement>(`button[aria-label="${t('email:sequences.editor.removeStep')}"]`)!
    expect(remove().disabled).toBe(true)
    await act(async () => button(t('email:sequences.addStep')).click())
    expect(container.querySelectorAll(`button[aria-label="${t('email:sequences.editor.removeStep')}"]`)).toHaveLength(2)
    expect(remove().disabled).toBe(false)
  })
})

describe('SequenceEditor A/B variant', () => {
  const pickTemplates = async (a: string, b?: string) => {
    const selects = () => [...container.querySelectorAll<HTMLSelectElement>('select[id$="-a"], select[id$="-b"]')]
    await select(selects()[0]!, a)
    if (b) await select(selects()[1]!, b)
  }

  it('adding variant B shows its picker and the saved body carries both templates', async () => {
    await render(null)
    const name = container.querySelector<HTMLInputElement>('#seq-name')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Acme sequence')
      name.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await pickTemplates('tpl-a')
    await act(async () => button(t('email:sequences.editor.addB')).click())
    expect(container.textContent).toContain(t('email:sequences.editor.variantB'))
    // An empty B picker blocks saving.
    expect(button(t('email:sequences.create')).disabled).toBe(true)
    await pickTemplates('tpl-a', 'tpl-b')
    await act(async () => button(t('email:sequences.create')).click())
    expect(api.post).toHaveBeenCalledTimes(1)
    const [url, body] = api.post.mock.calls[0]!
    expect(url).toBe('/api/email/sequences')
    expect((body as { steps: unknown[] }).steps).toEqual([{ kind: 'email', delayDays: 0, templateId: 'tpl-a', variantBTemplateId: 'tpl-b' }])
  })

  it('removing variant B hides the picker and drops it from the payload', async () => {
    await render(null)
    await pickTemplates('tpl-a')
    await act(async () => button(t('email:sequences.editor.addB')).click())
    await pickTemplates('tpl-a', 'tpl-b')
    await act(async () => button(t('email:sequences.editor.removeB')).click())
    expect(container.textContent).not.toContain(t('email:sequences.editor.variantB'))
    expect(button(t('email:sequences.editor.addB'))).toBeTruthy()
    // Adding it again starts empty: the old choice is not kept.
    await act(async () => button(t('email:sequences.editor.addB')).click())
    expect(container.querySelector<HTMLSelectElement>('select[id$="-b"]')!.value).toBe('')
  })
})

describe('steps helpers', () => {
  it('stepsPayload sends only the fields of the step kind and trims task text', () => {
    const email = { ...emptyStep(1), templateId: 'tpl-a', hasVariantB: true, variantBTemplateId: '', taskTitle: 'ignored' }
    const task = { ...emptyStep(3), kind: 'task' as const, taskTitle: ' Send brochure ', taskDescription: '  ', templateId: 'ignored' }
    expect(stepsPayload([email, task])).toEqual([
      { kind: 'email', delayDays: 1, templateId: 'tpl-a' },
      { kind: 'task', delayDays: 3, taskTitle: 'Send brochure' },
    ])
  })

  it('stepIsComplete needs a template (and B when enabled) for email, a title otherwise', () => {
    expect(stepIsComplete(emptyStep())).toBe(false)
    expect(stepIsComplete({ ...emptyStep(), templateId: 'tpl-a' })).toBe(true)
    expect(stepIsComplete({ ...emptyStep(), templateId: 'tpl-a', hasVariantB: true })).toBe(false)
    expect(stepIsComplete({ ...emptyStep(), kind: 'call', taskTitle: '   ' })).toBe(false)
    expect(stepIsComplete({ ...emptyStep(), kind: 'call', taskTitle: 'Call Acme' })).toBe(true)
  })

  it('stepsFromSequence gives one empty email step for a new sequence and keeps variant B of a saved one', () => {
    expect(stepsFromSequence(null)).toHaveLength(1)
    const [first] = stepsFromSequence({ steps: [{ kind: 'email', delayDays: 0, templateId: 'tpl-a', variantBTemplateId: 'tpl-b' }] } as unknown as EmailSequence)
    expect(first).toMatchObject({ hasVariantB: true, variantBTemplateId: 'tpl-b' })
  })

  it('parseBounceReason reads the guard format and rejects anything else', () => {
    expect(parseBounceReason('BOUNCE_RATE:0.070:50')).toEqual({ rate: 0.07, sends: 50 })
    expect(parseBounceReason('by hand')).toBeNull()
    expect(parseBounceReason(null)).toBeNull()
  })
})
