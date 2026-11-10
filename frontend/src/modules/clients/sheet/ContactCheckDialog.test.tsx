// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContactCheckDialog } from './TeamDialogs'
import type { ContactCheck, ProspectSheet } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const check = vi.hoisted(() => ({ value: { isPending: false, data: undefined as ContactCheck | undefined } }))
vi.mock('./use-sheet', async (importOriginal) => ({ ...(await importOriginal<typeof import('./use-sheet')>()), useContactCheck: () => check.value }))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  check.value = { isPending: false, data: { ownerName: 'Ana', claimedAt: '2026-10-01T09:00:00Z', lastActivityAt: null, lastActivityKind: null, lastActivityBy: null } }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
})

const sheet = { id: 'p1', name: 'Acme SRL', ownerName: 'Ana' } as ProspectSheet
const buttonByText = (text: string) => [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined

function open(canRequest = true) {
  const onContinue = vi.fn()
  const onRequestTransfer = vi.fn()
  act(() => root.render(<ContactCheckDialog sheet={sheet} open canRequest={canRequest} onContinue={onContinue} onRequestTransfer={onRequestTransfer} onOpenChange={() => {}} />))
  return { onContinue, onRequestTransfer }
}

describe('ContactCheckDialog (KM10)', () => {
  it('names the prospect, the owner and, with no activity, "niciun contact încă"', () => {
    open()
    const text = document.body.textContent ?? ''
    expect(text).toContain('Acme SRL are deja un responsabil')
    expect(text).toContain('E al lui Ana din')
    expect(text).toContain('niciun contact încă')
  })

  it('shows the last contact and its kind when there is one', () => {
    check.value = { isPending: false, data: { ownerName: 'Ana', claimedAt: null, lastActivityAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(), lastActivityKind: 'call', lastActivityBy: 'Ana' } }
    open()
    const text = document.body.textContent ?? ''
    expect(text).toContain('E al lui Ana')
    expect(text).toContain('ultimul contact')
    expect(text).not.toContain('niciun contact încă')
  })

  it('waits for the check before showing facts', () => {
    check.value = { isPending: true, data: undefined }
    open()
    expect(document.body.textContent).not.toContain('E al lui')
  })

  it('"Continuă" runs the held action, "Cere transfer" asks for the transfer instead', () => {
    const { onContinue, onRequestTransfer } = open()
    act(() => buttonByText('Continuă')!.click())
    expect(onContinue).toHaveBeenCalledOnce()
    expect(onRequestTransfer).not.toHaveBeenCalled()
    act(() => buttonByText('Cere transfer')!.click())
    expect(onRequestTransfer).toHaveBeenCalledOnce()
  })

  it('hides "Cere transfer" for someone who cannot request it', () => {
    open(false)
    expect(buttonByText('Cere transfer')).toBeUndefined()
    expect(buttonByText('Continuă')).toBeDefined()
  })
})
