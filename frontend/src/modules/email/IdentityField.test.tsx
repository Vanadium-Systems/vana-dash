// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { identitiesFor } from './IdentityField'
import { IdentityField } from './IdentityField'
import { ME_QUERY_KEY } from '@/shared/hooks/use-me'
import type { EmailIdentity, SessionPayload } from '@/shared/lib/types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const IDENTITIES: EmailIdentity[] = [
  { key: 'stefan', label: 'Ștefan', fromAddress: 'Ștefan <stefan@vanadium.systems>' },
  { key: 'sales', label: 'Sales', fromAddress: 'Vanadium Systems <sales@vanadium.systems>' },
  { key: 'outreach', label: 'Outreach', fromAddress: 'Vanadium Systems <outreach@vanadium.systems>' },
]

function session(mailboxes: string[] | null): SessionPayload {
  return {
    user: { id: 'u1', email: 'ion@vanadium.systems', displayName: 'Ion', role: { id: 'r1', name: 'Sales', kind: 'custom' }, status: 'active' },
    features: ['email.view', 'email.trimitere'],
    isPlatformAdmin: false,
    mailboxes,
    notificationPrefs: { chat: 'all', emailNew: true, alerts: true },
    navLayout: null,
    updatesSeenAt: null,
  }
}

function render(mailboxes: string[] | null, onChange = () => {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(ME_QUERY_KEY, session(mailboxes))
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <IdentityField id="from" value="sales" onChange={onChange} identities={IDENTITIES} />
      </QueryClientProvider>,
    ),
  )
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: [] }) }))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('cutiile de email per om', () => {
  it('adminul (mailboxes null) vede toate identitățile', () => {
    expect(identitiesFor(IDENTITIES, null).map((i) => i.key)).toEqual(['stefan', 'sales', 'outreach'])
  })

  it('un coleg vede doar cutiile lui', () => {
    render(['sales', 'outreach'])
    const options = [...container.querySelectorAll('option')].map((o) => o.value)
    expect(options).toEqual(['sales', 'outreach'])
  })

  it('cu o singură cutie, alegerea e deja făcută: text, nu dropdown', () => {
    render(['sales'])
    expect(container.querySelector('select')).toBeNull()
    expect(container.textContent).toContain('sales@vanadium.systems')
  })
})
