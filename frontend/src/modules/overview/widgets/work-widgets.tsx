import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { companyToday } from '@/shared/components/PeriodSelect'
import { Money } from '@/shared/components/Money'
import { Button } from '@/shared/components/ui/button'
import { Textarea } from '@/shared/components/ui/textarea'
import { api } from '@/shared/lib/api'
import { formatDate, formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { tNodes } from '@/shared/lib/i18n-nodes'
import { BASE_CURRENCY } from '@/shared/lib/locale'
import type { MoneyMeta, PlanGoal, PlanResponse, TenderOpportunity } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { formatRon } from '@/modules/plan/PlanBoard'
import type { ProspectRow, ListResponse } from '@/modules/clients/prospects/types'
import { useTaskCounts } from '@/modules/clients/tasks/use-tasks-data'
import type { TaskPage } from '@/modules/clients/tasks/types'
import { useFunnel } from '@/modules/clients/reports/use-report-data'
import { daysUntil, useDeadlines, type Deadline } from '../use-deadlines'
import { time } from './core-widgets'
import { WidgetFrame, widgetState } from './WidgetFrame'
import type { WidgetProps } from './types'

const ROW_LINK = 'flex min-w-0 items-center gap-3 rounded-sm py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

// The records list names the company's currency by code; the books only keep these three.
const unitOf = (currency: string) => t(`common:money.units.${currency as MoneyMeta['currency']}`)

interface ReceivableTotals {
  totals: { total: number; paid: number; open: number; overdue: number }
  companyCurrency: string
}

export function ReceivableWidget({ size, preview }: WidgetProps) {
  // One row is enough: the totals ignore the page and the tab.
  const records = useQuery({
    queryKey: ['accounting', 'records', 'receivable'],
    queryFn: () => api.get<ReceivableTotals>('/api/accounting/records?direction=out&pageSize=1'),
    staleTime: 30_000,
  })
  const totals = records.data?.totals
  const currency = unitOf(records.data?.companyCurrency ?? BASE_CURRENCY)
  const overdue = totals?.overdue ?? 0
  const open = totals?.open ?? 0
  return (
    <WidgetFrame
      title={t('overview:widgets.receivable')}
      module={t('common:nav.invoices')}
      action={{ to: '/accounting?status=overdue', label: t('overview:receivable.open') }}
      updatedAt={records.dataUpdatedAt}
      state={widgetState(records, open === 0)}
      emptyText={t('overview:receivable.nothingOpen')}
      onRetry={() => void records.refetch()}
      preview={preview}
    >
      {size === 's' ? (
        <div>
          <p className={cn('text-2xl font-semibold', overdue > 0 && 'text-destructive-text')}>
            <Money amount={overdue > 0 ? overdue : open} currency={currency} />
          </p>
          <p className="text-xs text-muted-foreground">
            {overdue > 0 ? tNodes('overview:receivable.overdueOfOpen', { open: <Money amount={open} currency={currency} /> }) : t('overview:receivable.noneOverdue')}
          </p>
        </div>
      ) : (
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-xs text-muted-foreground">{t('overview:receivable.toCollect')}</dt>
            <dd className="text-2xl font-semibold">
              <Money amount={open} currency={currency} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('overview:receivable.overdue')}</dt>
            <dd className={cn('text-2xl font-semibold', overdue > 0 && 'text-destructive-text')}>
              <Money amount={overdue} currency={currency} />
            </dd>
          </div>
        </dl>
      )}
    </WidgetFrame>
  )
}

/** The goal the person works towards now: the first open one of the company track with an MRR threshold, else the first open one anywhere. */
function nextGoal(plan: PlanResponse | undefined): PlanGoal | null {
  if (!plan) return null
  const open = (goals: PlanGoal[]) => goals.filter((goal) => goal.status === 'available')
  return open(plan.firma).find((goal) => goal.thresholdType === 'mrr_ron' && goal.thresholdValue) ?? open(plan.firma)[0] ?? open(plan.personal)[0] ?? null
}

export function PlanNextWidget({ size, preview }: WidgetProps) {
  const plan = useQuery({ queryKey: ['plan'], queryFn: () => api.get<PlanResponse>('/api/plan'), staleTime: 30_000 })
  const goal = nextGoal(plan.data)
  const target = goal?.thresholdValue ? Number(goal.thresholdValue) : null
  const mrrRon = plan.data?.mrrRon ?? 0
  const progress = target ? Math.min(100, Math.round((mrrRon / target) * 100)) : null
  return (
    <WidgetFrame
      title={t('overview:widgets.planNext')}
      module={t('common:nav.plan')}
      action={{ to: goal?.scope === 'firma' ? '/notes?tab=plan&scope=firma' : '/notes?tab=plan', label: t('overview:planNext.open') }}
      updatedAt={plan.dataUpdatedAt}
      state={widgetState(plan, goal === null)}
      emptyText={t('overview:planNext.none')}
      onRetry={() => void plan.refetch()}
      preview={preview}
    >
      <p className={cn('text-sm font-medium', size === 's' ? 'line-clamp-2' : 'truncate')}>{goal?.title}</p>
      {progress !== null && target ? (
        <div className="mt-2 space-y-1">
          <div
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={goal?.title}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {size === 's' ? formatNumber(progress, '%') : t('plan:mrrProgress', { current: formatRon(mrrRon), target: `${formatRon(target)} ${BASE_CURRENCY}` })}
          </p>
        </div>
      ) : null}
    </WidgetFrame>
  )
}

export function MyTasksWidget({ size, preview }: WidgetProps) {
  const shown = size === 'l' ? 8 : size === 'w' ? 2 : 1
  const tasks = useQuery({
    queryKey: ['prospects', 'task-page', 'home', shown],
    queryFn: () => api.get<TaskPage>(`/api/prospects/tasks?tab=today&scope=mine&pageSize=${shown}`),
    staleTime: 30_000,
  })
  const counts = useTaskCounts('mine')
  const overdue = counts.data?.overdue ?? 0
  // The wide widget has room for two lines of text: with overdue tasks to mention, one row gives way.
  const rows = (tasks.data?.rows ?? []).slice(0, size === 'w' && overdue > 0 ? 1 : undefined)
  const total = tasks.data?.total ?? 0
  return (
    <WidgetFrame
      title={t('overview:widgets.myTasks')}
      module={t('common:nav.clients')}
      action={{ to: '/clients?tab=taskuri', label: t('overview:tasks.open') }}
      updatedAt={tasks.dataUpdatedAt}
      state={widgetState(tasks, total === 0 && overdue === 0)}
      emptyText={t('overview:tasks.none')}
      onRetry={() => void tasks.refetch()}
      preview={preview}
    >
      {size === 's' ? (
        <div>
          <p className="text-2xl font-semibold tnum">{total}</p>
          <p className="truncate text-xs text-muted-foreground">{rows[0]?.title ?? t('overview:tasks.noneToday')}</p>
        </div>
      ) : (
        <ul className="divide-y">
          {rows.map((task) => (
            <li key={task.id}>
              <Link to={`/clients/${task.prospectId}`} tabIndex={preview ? -1 : undefined} className={ROW_LINK}>
                <span className="w-12 shrink-0 text-xs text-text-3 tnum">{time(task.dueAt)}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                <span className="hidden w-32 shrink-0 truncate text-xs text-text-3 sm:block">{task.prospectName}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {size === 'l' && total > rows.length ? <p className="mt-1 text-xs text-muted-foreground">{t('overview:widgets.more', { count: total - rows.length })}</p> : null}
      {overdue > 0 ? <p className="mt-1 text-xs text-destructive-text">{t('overview:tasks.overdue', { count: overdue })}</p> : null}
    </WidgetFrame>
  )
}

function deadlineTo(deadline: Deadline): string {
  if (deadline.kind === 'invoice_due') return deadline.ref ? `/accounting/records/${deadline.ref.id}` : '/accounting?status=overdue'
  if (deadline.kind === 'declaration') return '/accounting?tab=declaratii'
  return '/settings'
}

function DeadlineWhen({ deadline }: { deadline: Deadline }) {
  const days = daysUntil(deadline.dueAt)
  const text = deadline.overdue
    ? t('overview:deadlines.overdueDays', { count: Math.max(1, -days) })
    : days <= 0
      ? t('overview:deadlines.today')
      : t('overview:deadlines.inDays', { count: days })
  return <span className={cn('shrink-0 text-xs tnum', deadline.overdue ? 'text-destructive-text' : 'text-text-3')}>{text}</span>
}

export function DeadlinesWidget({ size, preview }: WidgetProps) {
  const deadlines = useDeadlines()
  const items = deadlines.data?.items ?? []
  const shown = items.slice(0, size === 's' ? 1 : 2)
  return (
    <WidgetFrame
      title={t('overview:widgets.deadlines')}
      module={t('common:nav.invoices')}
      action={{ to: '/accounting', label: t('overview:deadlines.open') }}
      updatedAt={deadlines.dataUpdatedAt}
      state={widgetState(deadlines, items.length === 0)}
      emptyText={t('overview:deadlines.none')}
      onRetry={() => void deadlines.refetch()}
      preview={preview}
    >
      <ul className="divide-y">
        {shown.map((deadline) => (
          <li key={`${deadline.kind}-${deadline.title}`}>
            <Link to={deadlineTo(deadline)} tabIndex={preview ? -1 : undefined} className={cn(ROW_LINK, size === 's' && 'flex-col items-start gap-0 py-0')}>
              <span className="w-full min-w-0 flex-1 truncate text-sm">
                <span className="text-text-3">{t(`overview:deadlines.kind.${deadline.kind}`)}</span> {deadline.title}
              </span>
              <DeadlineWhen deadline={deadline} />
            </Link>
          </li>
        ))}
      </ul>
      {size === 's' && items.length > 1 ? <p className="mt-1 text-xs text-muted-foreground">{t('overview:deadlines.total', { count: items.length })}</p> : null}
    </WidgetFrame>
  )
}

export function QuickNoteWidget({ preview }: WidgetProps) {
  const queryClient = useQueryClient()
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'saved' | 'failed'>('idle')
  const save = useMutation({
    mutationFn: (body: string) => api.post('/api/notes', { body }),
    onSuccess: () => {
      setText('')
      setStatus('saved')
      void queryClient.invalidateQueries({ queryKey: ['notes'] })
    },
    onError: () => setStatus('failed'),
  })
  return (
    <WidgetFrame title={t('overview:widgets.quickNote')} module={t('common:nav.notes')} state="ready" preview={preview}>
      <div className="flex items-end gap-2">
        <Textarea
          className="h-14 min-h-0 flex-1 resize-none"
          rows={2}
          value={text}
          disabled={preview}
          placeholder={t('overview:quickNote.placeholder')}
          aria-label={t('overview:quickNote.label')}
          onChange={(event) => {
            setText(event.target.value)
            setStatus('idle')
          }}
        />
        <Button disabled={preview || save.isPending || text.trim() === ''} onClick={() => save.mutate(text)}>
          {t('common:actions.save')}
        </Button>
      </div>
      <p role="status" className={cn('mt-1 h-4 truncate text-xs', status === 'failed' ? 'text-destructive-text' : 'text-muted-foreground')}>
        {status === 'saved' ? t('overview:quickNote.saved') : status === 'failed' ? t('overview:quickNote.failed') : ''}
      </p>
    </WidgetFrame>
  )
}

export function SuggestedLeadsWidget({ size, preview }: WidgetProps) {
  const limit = size === 'l' ? 8 : 2
  const leads = useQuery({
    queryKey: ['prospects', 'list', 'suggested', limit],
    queryFn: () => api.get<ListResponse<ProspectRow>>(`/api/prospects?kind=companies&sort=score&dir=desc&pageSize=${limit}`),
    staleTime: 30_000,
  })
  const rows = (leads.data?.rows ?? []).filter((lead) => lead.score !== null)
  return (
    <WidgetFrame
      title={t('overview:widgets.suggestedLeads')}
      module={t('common:nav.clients')}
      action={{ to: '/clients', label: t('overview:leads.open') }}
      updatedAt={leads.dataUpdatedAt}
      state={widgetState(leads, rows.length === 0)}
      emptyText={t('overview:leads.none')}
      onRetry={() => void leads.refetch()}
      preview={preview}
    >
      <ul className="divide-y">
        {rows.map((lead) => (
          <li key={lead.id}>
            <Link to={`/clients/${lead.id}`} tabIndex={preview ? -1 : undefined} className={ROW_LINK}>
              <span className="min-w-0 flex-1 truncate text-sm">{lead.name}</span>
              <span className="shrink-0 text-sm font-medium tnum">{formatNumber(Number(lead.score))}</span>
            </Link>
          </li>
        ))}
      </ul>
    </WidgetFrame>
  )
}

/** The last 30 days, as the server wants them: two plain dates in the company's zone. */
function lastThirtyDays(): [string, string] {
  const to = companyToday()
  const from = new Date(`${to}T12:00:00Z`)
  from.setUTCDate(from.getUTCDate() - 29)
  return [from.toISOString().slice(0, 10), to]
}

export function FunnelWidget({ size, preview }: WidgetProps) {
  const [from, to] = lastThirtyDays()
  const funnel = useFunnel(from, to)
  const stages = funnel.data?.stages ?? []
  const shown = stages.slice(0, size === 'l' ? 8 : 4)
  const top = Math.max(1, ...stages.map((stage) => stage.reached))
  return (
    <WidgetFrame
      title={t('overview:widgets.funnel')}
      module={t('common:nav.clients')}
      action={{ to: '/clients?tab=rapoarte', label: t('overview:funnel.open') }}
      updatedAt={funnel.dataUpdatedAt}
      state={widgetState(funnel, stages.every((stage) => stage.reached === 0))}
      emptyText={t('overview:funnel.none')}
      onRetry={() => void funnel.refetch()}
      preview={preview}
    >
      {/* Horizontal bars in stage order, not a funnel shape (DESIGN.md "Charts"). */}
      <ul className="space-y-1.5">
        {shown.map((stage) => (
          <li key={stage.status} className="grid grid-cols-[6rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-xs">
            <span className="truncate text-muted-foreground">{stage.label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <span className="block h-full rounded-full" style={{ width: `${(stage.reached / top) * 100}%`, background: 'var(--s1)' }} />
            </span>
            <span className="text-right text-sm tnum">{formatNumber(stage.reached)}</span>
          </li>
        ))}
      </ul>
    </WidgetFrame>
  )
}

const NEW_TENDER_DAYS = 7

export function NewTendersWidget({ preview }: WidgetProps) {
  const tenders = useQuery({ queryKey: ['tenders', 'new'], queryFn: () => api.get<TenderOpportunity[]>('/api/tenders'), staleTime: 30_000 })
  const since = Date.now() - NEW_TENDER_DAYS * 86_400_000
  const fresh = (tenders.data ?? []).filter((tender) => new Date(tender.createdAt).getTime() >= since).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return (
    <WidgetFrame
      title={t('overview:widgets.newTenders')}
      module={t('common:nav.tenders')}
      action={{ to: '/tenders', label: t('overview:tenders.open') }}
      updatedAt={tenders.dataUpdatedAt}
      state={widgetState(tenders, fresh.length === 0)}
      emptyText={t('overview:tenders.none', { count: NEW_TENDER_DAYS })}
      onRetry={() => void tenders.refetch()}
      preview={preview}
    >
      <ul className="divide-y">
        {fresh.slice(0, 2).map((tender) => (
          <li key={tender.id}>
            <Link to="/tenders" tabIndex={preview ? -1 : undefined} className={ROW_LINK}>
              <span className="min-w-0 flex-1 truncate text-sm">{tender.title}</span>
              {tender.deadlineAt ? <span className="shrink-0 text-xs text-text-3">{t('overview:tenders.until', { date: formatDate(tender.deadlineAt) })}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </WidgetFrame>
  )
}
