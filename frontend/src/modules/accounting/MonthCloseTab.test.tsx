// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultMonthClosePeriod, MonthCloseTab } from './MonthCloseTab'
import { SupplierRulesCard } from './SupplierRulesCard'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.stubGlobal('ResizeObserver', class {
  observe() {}
  disconnect() {}
  unobserve() {}
})

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  download: vi.fn(),
}))

vi.mock('@/shared/lib/api', () => ({
  api: apiMock,
  ApiError: class extends Error {
    status = 400
  },
}))

const useMeMock = vi.hoisted(() => ({
  can: vi.fn((_feature?: string | null) => true),
}))

vi.mock('@/shared/hooks/use-me', () => ({
  useMe: () => ({
    can: useMeMock.can,
    me: { id: 'u1', email: 'test@example.com', role: { kind: 'admin' }, features: [] },
  }),
}))

vi.mock('@/shared/components/ui/confirm-dialog', () => ({
  useConfirm: () => async () => true,
}))

let container: HTMLDivElement
let root: Root

function renderWithProviders(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return act(async () => {
    root.render(
      <MemoryRouter>
        <QueryClientProvider client={client}>{node}</QueryClientProvider>
      </MemoryRouter>,
    )
  })
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
  useMeMock.can.mockImplementation(() => true)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('defaultMonthClosePeriod', () => {
  it('returns the previous month when day <= 25, including January -> December', () => {
    expect(defaultMonthClosePeriod(new Date(2026, 10, 15))).toBe('2026-10')
    expect(defaultMonthClosePeriod(new Date(2026, 10, 25))).toBe('2026-10')
    expect(defaultMonthClosePeriod(new Date(2026, 0, 10))).toBe('2025-12')
  })

  it('returns the current month when day >= 26', () => {
    expect(defaultMonthClosePeriod(new Date(2026, 10, 26))).toBe('2026-11')
    expect(defaultMonthClosePeriod(new Date(2026, 0, 28))).toBe('2026-01')
  })
})

describe('MonthCloseTab', () => {
  it('renders month close checklist rows from API', async () => {
    apiMock.get.mockResolvedValue({
      month: '2026-10',
      closure: { closed: false, closedAt: null, closedBy: null, note: null },
      counts: {
        all: 2,
        issued: 0,
        receivedEfactura: 0,
        receivedEmailOrManual: 1,
        expectedMissing: 1,
        unarchived: 1,
      },
      items: [
        {
          kind: 'record',
          id: 'rec-1',
          direction: 'in',
          source: 'email',
          counterpartyName: 'Anthropic, PBC',
          counterpartyCif: null,
          counterpartyCountry: 'US',
          documentNumber: 'ANTH-001',
          issuedAt: '2026-10-14T00:00:00.000Z',
          amount: 45,
          currency: 'EUR',
          paymentStatus: 'paid',
          reverseChargeType: 'non_eu_services',
          reverseChargeVatRate: 21,
          needsReview: true,
          hasPdf: true,
          hasXml: false,
          archiveFileId: null,
          isArchived: false,
          emailMessageId: 'msg-1',
          supplierRuleId: 'rule-1',
          senderSearchHint: 'mail.anthropic.com',
        },
        {
          kind: 'expected',
          expectedId: 'exp-rule-2',
          expectedSource: 'supplier_rule',
          recurringExpenseId: null,
          supplierRuleId: 'rule-2',
          counterpartyName: 'Hetzner Online GmbH',
          counterpartyCif: 'DE812871812',
          counterpartyCountry: 'DE',
          expectedDate: '2026-10-01',
          amount: null,
          currency: 'EUR',
          category: 'Hosting',
          reverseChargeType: 'eu_services',
          reverseChargeVatRate: 21,
          senderSearchHint: 'hetzner.com',
        },
      ],
    })

    await renderWithProviders(<MonthCloseTab />)
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Anthropic, PBC')
      expect(container.textContent).toContain('Hetzner Online GmbH')
    })
  })
})

describe('SupplierRulesCard', () => {
  it('renders supplier email rules list', async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url.includes('/supplier-rules')) {
        return Promise.resolve([
          {
            id: 'rule-1',
            senderPattern: 'invoice+statements@mail.anthropic.com',
            subjectContains: null,
            attachmentNamePattern: 'Invoice-',
            counterpartyName: 'Anthropic, PBC',
            counterpartyCif: null,
            counterpartyCountry: 'US',
            currency: 'EUR',
            category: 'AI / Cloud',
            reverseChargeType: 'non_eu_services',
            reverseChargeVatRate: '0',
            recurringExpenseId: null,
            active: true,
            createdAt: '2026-11-15T10:00:00.000Z',
            updatedAt: '2026-11-15T10:00:00.000Z',
          },
        ])
      }
      return Promise.resolve([])
    })

    await renderWithProviders(<SupplierRulesCard />)
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Anthropic, PBC')
      expect(container.textContent).toContain('invoice+statements@mail.anthropic.com')
    })
  })

  it('hides recurring expense select and skips /recurring-expenses when user lacks facturi.cheltuieli', async () => {
    useMeMock.can.mockImplementation((feature?: string | null) => feature !== 'facturi.cheltuieli')
    apiMock.get.mockImplementation(() => Promise.resolve([]))

    await renderWithProviders(<SupplierRulesCard />)
    await vi.waitFor(() => {
      expect(apiMock.get).toHaveBeenCalledWith('/api/accounting/supplier-rules')
    })

    const calledUrls = apiMock.get.mock.calls.map((call) => String(call[0]))
    expect(calledUrls.some((u) => u.includes('/recurring-expenses'))).toBe(false)

    // Open the add-rule dialog and verify the recurring expense select is not rendered
    const buttons = Array.from(container.querySelectorAll('button'))
    const addButton = buttons.find((b) => b.textContent && /adaug|add/i.test(b.textContent))
    expect(addButton).toBeTruthy()
    await act(async () => {
      addButton?.click()
    })
    expect(document.body.querySelector('#sr-rec')).toBeNull()
  })
})
