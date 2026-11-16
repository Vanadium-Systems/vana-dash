import { useMe } from '@/shared/hooks/use-me'
import { useMoneyQuery } from '@/shared/hooks/use-money-query'
import { BASE_CURRENCY } from '@/shared/lib/locale'
import type { RevenueSeries } from '@/shared/lib/types'
import { t } from '@/shared/lib/i18n'
import { HomeFigures } from './HomeFigures'
import { HomeGrid } from './HomeGrid'
import { HomeWindow } from './HomeWindow'
import { NextStepCard, type NextStep } from './NextStepCard'
import { daysUntil, useDeadlines, type Deadline } from './use-deadlines'
import { usePaymentArrival } from './payment-arrival'
import { useTodoItems } from './widgets/core-widgets'
import { COLLECTED_KEY, COLLECTED_PATH } from './widgets/money-widgets'

// Home (DESIGN.md "Two layers", the style's §6): the window with the photo of the hour, the figures
// already computed, "Următorul pas", then the person's own grid of widgets. The sentence of two
// seconds: how much came in, what is on today, what is burning.

function deadlineLabel(deadline: Deadline): string {
  return t(`overview:deadlines.kind.${deadline.kind}`)
}

function deadlineTo(deadline: Deadline): string {
  if (deadline.kind === 'invoice_due') return deadline.ref ? `/accounting/records/${deadline.ref.id}` : '/accounting?status=overdue'
  if (deadline.kind === 'declaration') return '/accounting?tab=declaratii'
  return '/settings'
}

export function OverviewPage() {
  const { can } = useMe()
  const todo = useTodoItems()
  const deadlines = useDeadlines()
  // Same query as the figures; one more observer that refreshes every minute while Home is open.
  const collected = useMoneyQuery<RevenueSeries>(COLLECTED_KEY, COLLECTED_PATH, { enabled: can('financiar.view'), refetchInterval: 60_000 })
  usePaymentArrival(collected.data?.total, t(`common:money.units.${collected.money?.currency ?? BASE_CURRENCY}`))

  const deadlineItems = deadlines.data?.items ?? []
  const overdue = deadlineItems.filter((d) => d.kind === 'invoice_due' && d.overdue)
  const soon = deadlineItems.filter((d) => !(d.kind === 'invoice_due' && d.overdue) && daysUntil(d.dueAt) <= 3)
  const signalsReady = !todo.query.isPending && (!can('facturi.view') || !deadlines.isPending)
  const signals = signalsReady
    ? {
        critical: todo.critical,
        warnings: todo.warnings,
        overdueInvoices: overdue.length,
        deadlinesSoon: soon.length,
        bookings: todo.items.filter((item) => item.id.startsWith('booking-')).length,
      }
    : null

  const firstAlert = todo.items[0]
  const firstDeadline = overdue[0] ?? soon[0]
  // The most serious thing first: a critical alert, then money owed, then a deadline, then the rest.
  let step: NextStep | null = null
  if (firstAlert && todo.critical > 0) step = { id: firstAlert.id, title: firstAlert.title, detail: firstAlert.meta, to: firstAlert.to }
  else if (firstDeadline) step = { id: `deadline-${firstDeadline.title}`, title: `${deadlineLabel(firstDeadline)}: ${firstDeadline.title}`, to: deadlineTo(firstDeadline) }
  else if (firstAlert) step = { id: firstAlert.id, title: firstAlert.title, detail: firstAlert.meta, to: firstAlert.to }

  return (
    <div className="space-y-6">
      <HomeWindow signals={signals} firstTo={step?.to ?? (todo.items.length > 0 ? '/alerts' : null)} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <HomeFigures />
        <NextStepCard step={step} />
      </div>
      <HomeGrid />
    </div>
  )
}
