// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatMoney } from '@/shared/lib/format'
import { PaymentPeek, type PayableRecord } from './PaymentPeek'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }))
vi.mock('@/shared/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/shared/lib/api')>()), api }))

const norm = (text: string | null | undefined) => (text ?? '').replace(/\s/g, ' ')

const RECORD: PayableRecord = {
  id: 'rec-1',
  direction: 'out',
  currency: 'RON',
  amount: '1000.00',
  documentNumber: 'VAN-0042',
  counterpartyName: 'Acme SRL',
  paymentStatus: 'unpaid',
  remaining: 1000,
}

let container: HTMLDivElement
let root: Root
let onClose: ReturnType<typeof vi.fn<() => void>>

async function open(record: PayableRecord = RECORD) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <MemoryRouter>
          <PaymentPeek record={record} onClose={onClose} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  })
}

const amountInput = () => document.querySelector('input[inputmode="decimal"]') as HTMLInputElement
const consequence = () => norm(document.querySelector('[data-testid="payment-consequence"]')?.textContent)
const submitButton = () => document.querySelector('[data-testid="payment-submit"]') as HTMLButtonElement

async function typeAmount(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(amountInput(), value)
    amountInput().dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function submit() {
  await act(async () => {
    submitButton().click()
  })
}

beforeEach(() => {
  api.post.mockReset()
  api.post.mockResolvedValue({})
  onClose = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('PaymentPeek', () => {
  it('the amount defaults to the rest and the button names it', async () => {
    await open({ ...RECORD, remaining: 400 })
    expect(amountInput().value).toBe('400,00')
    expect(norm(submitButton().textContent)).toBe(norm(`Înregistrează ${formatMoney(400, 'RON')}`))
  })

  it('a smaller amount writes Neîncasată → Parțial with the rest', async () => {
    await open()
    await typeAmount('300')
    expect(consequence()).toBe(norm(`Stare: Neîncasată → Parțial · Rest: ${formatMoney(700, 'RON')}`))
    expect(norm(submitButton().textContent)).toBe(norm(`Înregistrează ${formatMoney(300, 'RON')}`))
  })

  it('the full rest writes → Încasată with a zero rest', async () => {
    await open()
    await typeAmount('1000,00')
    expect(consequence()).toBe(norm(`Stare: Neîncasată → Încasată · Rest: ${formatMoney(0, 'RON')}`))
  })

  it('on a received document the words are Neplătită / Plătită', async () => {
    await open({ ...RECORD, direction: 'in' })
    expect(consequence()).toContain('Neplătită → Plătită')
  })

  it('a partially paid document starts from Parțial', async () => {
    await open({ ...RECORD, paymentStatus: 'partial', remaining: 600 })
    await typeAmount('100')
    expect(consequence()).toBe(norm(`Stare: Parțial → Parțial · Rest: ${formatMoney(500, 'RON')}`))
  })

  it('more than the rest drops the consequence and blocks the submit with the over-payment message', async () => {
    await open()
    await typeAmount('1500')
    expect(consequence()).toBe('')
    await submit()
    expect(api.post).not.toHaveBeenCalled()
    expect(norm(document.body.textContent)).toContain(norm(`Suma depășește restul de plată (${formatMoney(1000, 'RON')})`))
  })

  it('a zero or empty amount shows no consequence, a plain button and the invalid message', async () => {
    await open()
    await typeAmount('')
    expect(consequence()).toBe('')
    expect(submitButton().textContent).toBe('Înregistrează')
    await submit()
    expect(api.post).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Introdu o sumă mai mare ca zero')
  })

  it('direction out posts to the invoicing route with the typed fields', async () => {
    await open()
    await typeAmount('250,50')
    await submit()
    expect(api.post).toHaveBeenCalledTimes(1)
    const [url, body] = api.post.mock.calls[0]!
    expect(url).toBe('/api/invoicing/invoices/rec-1/payments')
    expect(body).toMatchObject({ amount: 250.5, method: 'bank' })
    expect(body.paidAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(body.reference).toBeUndefined()
    expect(body.note).toBeUndefined()
    expect(onClose).toHaveBeenCalled()
  })

  it('direction in posts to the accounting route', async () => {
    await open({ ...RECORD, id: 'rec-9', direction: 'in' })
    await submit()
    const [url, body] = api.post.mock.calls[0]!
    expect(url).toBe('/api/accounting/records/rec-9/payments')
    expect(body).toMatchObject({ amount: 1000, method: 'bank' })
  })

  it('a server error stays in the panel and the panel stays open', async () => {
    const { ApiError } = await import('@/shared/lib/api')
    api.post.mockRejectedValue(new ApiError(409, 'Conflict', 'OVERPAYMENT'))
    await open()
    await submit()
    expect(document.body.textContent).toContain('Suma depășește restul de plată.')
    expect(onClose).not.toHaveBeenCalled()
  })
})
