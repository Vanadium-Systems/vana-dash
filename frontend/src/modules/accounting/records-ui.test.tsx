// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ME_QUERY_KEY } from '@/shared/hooks/use-me'
import { formatDate, formatMoney } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { RecordsPage } from '@/shared/lib/types'
import { DueDate, RecordPaymentBadge, TotalsBand } from './records-ui'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TOTALS: RecordsPage['totals'] = { total: 12000, paid: 4500.5, open: 7499.5, overdue: 1200 }

let container: HTMLDivElement
let root: Root

// Intl puts a no-break space before the currency sign; the DOM text and the helper agree on it, but normalise anyway.
const norm = (text: string | null | undefined) => (text ?? '').replace(/\s/g, ' ')

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(ME_QUERY_KEY, { tenant: { currency: 'RON' }, features: [] })
  await act(async () => {
    root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
  })
}

const band = () => container.querySelector('[data-testid="records-totals"]') as HTMLElement
const figures = () => Array.from(container.querySelectorAll('dl > div')).map((row) => [norm(row.querySelector('dt')?.textContent), norm(row.querySelector('dd')?.textContent)])

describe('TotalsBand', () => {
  it('direction out: De încasat leads, then Total, Încasat, Restant, with formatted amounts', async () => {
    await render(<TotalsBand direction="out" totals={TOTALS} loading={false} stale={false} />)
    expect(figures()).toEqual([
      ['De încasat', norm(formatMoney(TOTALS.open, 'RON'))],
      ['Total', norm(formatMoney(TOTALS.total, 'RON'))],
      ['Încasat', norm(formatMoney(TOTALS.paid, 'RON'))],
      ['Restant', norm(formatMoney(TOTALS.overdue, 'RON'))],
    ])
  })

  it('direction in: De plătit and Plătit instead', async () => {
    await render(<TotalsBand direction="in" totals={TOTALS} loading={false} stale={false} />)
    const labels = figures().map(([label]) => label)
    expect(labels).toEqual(['De plătit', 'Total', 'Plătit', 'Restant'])
  })

  it('loading shows skeletons, no figures, and marks the band busy', async () => {
    await render(<TotalsBand direction="out" totals={undefined} loading={true} stale={false} />)
    expect(container.querySelector('dl')).toBeNull()
    expect(band().getAttribute('aria-busy')).toBe('true')
    expect(band().querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(band().querySelector('dd')).toBeNull()
  })

  it('loading with old totals still shows skeleton, not numbers', async () => {
    await render(<TotalsBand direction="out" totals={TOTALS} loading={true} stale={false} />)
    expect(container.querySelector('dl')).toBeNull()
  })

  it('stale keeps the figures but dims the band and marks it busy', async () => {
    await render(<TotalsBand direction="out" totals={TOTALS} loading={false} stale={true} />)
    expect(container.querySelector('dl')).not.toBeNull()
    expect(band().className).toContain('opacity-60')
    expect(band().getAttribute('aria-busy')).toBe('true')
  })

  it('fresh band is neither dimmed nor busy', async () => {
    await render(<TotalsBand direction="out" totals={TOTALS} loading={false} stale={false} />)
    expect(band().className).not.toContain('opacity-60')
    expect(band().getAttribute('aria-busy')).toBe('false')
  })

  it('Restant is warm only when something is overdue', async () => {
    await render(<TotalsBand direction="out" totals={TOTALS} loading={false} stale={false} />)
    expect(container.querySelectorAll('dd.text-warning-text')).toHaveLength(1)
    await render(<TotalsBand direction="out" totals={{ ...TOTALS, overdue: 0 }} loading={false} stale={false} />)
    expect(container.querySelectorAll('dd.text-warning-text')).toHaveLength(0)
  })
})

describe('RecordPaymentBadge', () => {
  it('unpaid and paid use the direction words', async () => {
    await render(<RecordPaymentBadge direction="out" status="unpaid" remaining={100} currency="RON" />)
    expect(container.textContent).toBe('Neîncasată')
    await render(<RecordPaymentBadge direction="out" status="paid" remaining={0} currency="RON" />)
    expect(container.textContent).toBe('Încasată')
    await render(<RecordPaymentBadge direction="in" status="unpaid" remaining={100} currency="RON" />)
    expect(container.textContent).toBe('Neplătită')
    await render(<RecordPaymentBadge direction="in" status="paid" remaining={0} currency="RON" />)
    expect(container.textContent).toBe('Plătită')
  })

  it('partial writes the rest as text', async () => {
    await render(<RecordPaymentBadge direction="out" status="partial" remaining={250.5} currency="RON" />)
    expect(norm(container.textContent)).toBe(norm(t('accounting:records.payment.partial', { rest: formatMoney(250.5, 'RON') })))
    expect(container.textContent).toMatch(/^Parțial · rest /)
  })

  it('overdue changes the tone of an open document but not of a paid one', async () => {
    await render(<RecordPaymentBadge direction="out" status="unpaid" remaining={100} currency="RON" />)
    const plain = container.firstElementChild?.className
    await render(<RecordPaymentBadge direction="out" status="unpaid" remaining={100} currency="RON" overdue />)
    const overdue = container.firstElementChild?.className
    expect(overdue).not.toBe(plain)
    expect(container.textContent).toBe('Neîncasată')
    await render(<RecordPaymentBadge direction="out" status="paid" remaining={0} currency="RON" />)
    const paid = container.firstElementChild?.className
    await render(<RecordPaymentBadge direction="out" status="paid" remaining={0} currency="RON" overdue />)
    expect(container.firstElementChild?.className).toBe(paid)
  })
})

describe('DueDate', () => {
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

  it('overdue shows the date and how many days late', async () => {
    const dueAt = daysAgo(12)
    await render(<DueDate dueAt={dueAt} overdue />)
    expect(container.textContent).toContain(formatDate(dueAt))
    expect(container.textContent).toMatch(/de 1[12] zile/)
    expect(container.firstElementChild?.className).toContain('text-warning-text')
  })

  it('not overdue shows only the date', async () => {
    const dueAt = daysAgo(-5)
    await render(<DueDate dueAt={dueAt} overdue={false} />)
    expect(container.textContent).toBe(formatDate(dueAt))
    expect(container.firstElementChild?.className).not.toContain('text-warning-text')
  })

  it('no due date is a dash', async () => {
    await render(<DueDate dueAt={null} overdue={false} />)
    expect(container.textContent).toBe('—')
  })
})
