import type { InfiniteData } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Button } from '@/shared/components/ui/button'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { Timeline, type TimelineEntry } from '@/shared/components/Timeline'
import { formatDateTime } from '@/shared/lib/format'
import { t, type TKey } from '@/shared/lib/i18n'
import { useStatuses } from '../prospects/use-prospect-data'
import type { ProspectStatusEntry } from '@/shared/lib/types'
import type { TimelineKind, TimelinePage, TimelineRow } from './types'
import { useTimeline } from './use-sheet'

const AUDIT_ACTION: Record<string, TKey> = {
  'prospect.creat': 'clients:sheet.audit.created',
  'prospect.revendicat': 'clients:sheet.audit.claimed',
  'prospect.eliberat': 'clients:sheet.audit.released',
  'prospect.eliberat.automat': 'clients:sheet.audit.releasedAuto',
  'prospect.transferat': 'clients:sheet.audit.transferred',
  'prospect.colaborator.adaugat': 'clients:sheet.audit.collaboratorAdded',
  'prospect.colaborator.setat': 'clients:sheet.audit.collaboratorSet',
  'prospect.colaborator.scos': 'clients:sheet.audit.collaboratorRemoved',
  'prospect.contact.adaugat': 'clients:sheet.audit.contactAdded',
  'prospect.contact.modificat': 'clients:sheet.audit.contactChanged',
  'prospect.contact.sters': 'clients:sheet.audit.contactRemoved',
  'prospect.promovat': 'clients:sheet.audit.promoted',
  'prospect.oferta': 'clients:sheet.audit.offer',
  'prospect.import': 'clients:sheet.audit.imported',
}

const FIELD_LABEL: Record<string, TKey> = {
  name: 'clients:sheet.fields.name',
  cif: 'clients:sheet.fields.cif',
  website: 'clients:sheet.fields.website',
  caenCode: 'clients:sheet.fields.caenCode',
  employeeCount: 'clients:sheet.fields.employeeCount',
  source: 'clients:sheet.fields.source',
  valueAmount: 'clients:sheet.fields.value',
  valueCurrency: 'clients:sheet.fields.value',
  expectedCloseAt: 'clients:sheet.fields.expectedCloseAt',
  revenue: 'clients:sheet.fields.revenue',
  profit: 'clients:sheet.fields.profit',
  debt: 'clients:sheet.fields.debt',
  equity: 'clients:sheet.fields.equity',
  cash: 'clients:sheet.fields.cash',
  receivables: 'clients:sheet.fields.receivables',
  inventory: 'clients:sheet.fields.inventory',
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const statusLabel = (statuses: ProspectStatusEntry[], key: unknown) => statuses.find((status) => status.key === key)?.label ?? text(key)

function Quote({ children }: { children: string }) {
  return <span className="mt-0.5 line-clamp-2 block whitespace-pre-wrap text-muted-foreground">{children}</span>
}

function describe(row: TimelineRow, statuses: ProspectStatusEntry[]): ReactNode | null {
  const data = row.data
  switch (row.kind) {
    case 'audit': {
      const action = text(data.action)
      const changed = Object.keys((data.changes as Record<string, unknown> | null) ?? {})
      if (action === 'prospect.modificat') {
        // Stage moves have their own entry; saying it twice only clutters the list.
        if (changed.every((field) => field === 'status' || field === 'lostReason')) return null
        const names = [...new Set(changed.filter((field) => field !== 'status' && field !== 'lostReason').map((field) => (FIELD_LABEL[field] ? t(FIELD_LABEL[field]) : field)))]
        return t('clients:sheet.audit.modified', { fields: names.join(', ') })
      }
      const key = AUDIT_ACTION[action]
      return key ? t(key) : t('clients:sheet.audit.other')
    }
    case 'note':
      return (
        <>
          {t('clients:sheet.activity.note')}
          <Quote>{text(data.body)}</Quote>
        </>
      )
    case 'task':
      return data.doneAt
        ? t('clients:sheet.activity.taskDone', { title: text(data.title) })
        : t('clients:sheet.activity.taskPlanned', { title: text(data.title), due: formatDateTime(text(data.dueAt)) })
    case 'stage':
      return t('clients:sheet.activity.stage', { from: statusLabel(statuses, data.from), to: statusLabel(statuses, data.to) })
    case 'call': {
      const seconds = typeof data.durationSeconds === 'number' ? data.durationSeconds : 0
      return t('clients:sheet.activity.call', { title: text(data.title) }) + (seconds > 0 ? ` · ${t('clients:sheet.activity.minutes', { count: Math.max(1, Math.round(seconds / 60)) })}` : '')
    }
    case 'email':
      return (
        <>
          {t(data.kind === 'received' ? 'clients:sheet.activity.emailIn' : 'clients:sheet.activity.emailOut', { subject: text(data.subject) })}
          <span className="block text-muted-foreground">{[text(data.recipient), data.openedAt ? t('clients:sheet.activity.opened') : ''].filter(Boolean).join(' · ')}</span>
        </>
      )
    case 'sequence':
      return t('clients:sheet.activity.sequence', { sequence: text(data.sequence), step: Number(data.step ?? 0) + 1 })
  }
}

export function timelineEntries(data: InfiniteData<TimelinePage> | undefined, kinds: TimelineKind[] | null, statuses: ProspectStatusEntry[]): TimelineEntry[] {
  const rows = data?.pages.flatMap((page) => page.entries) ?? []
  return rows
    .filter((row) => !kinds || kinds.includes(row.kind))
    .flatMap((row) => {
      const body = describe(row, statuses)
      return body === null ? [] : [{ id: `${row.kind}-${row.id}`, author: row.author, at: row.at, text: body }]
    })
}

/** The activity list and, with `kinds`, the Emails and Calls tabs: the same stream, narrowed. */
export function ActivityTab({ prospectId, kinds }: { prospectId: string; kinds: TimelineKind[] | null }) {
  const timeline = useTimeline(prospectId)
  const statuses = useStatuses().data ?? []
  if (timeline.isPending) return <ListSkeleton rows={5} />
  if (timeline.isError) {
    return (
      <EmptyState
        kind="new"
        title={t('clients:sheet.loadFailed')}
        action={
          <Button type="button" variant="outline" onClick={() => void timeline.refetch()}>
            {t('common:actions.retry')}
          </Button>
        }
      />
    )
  }
  const entries = timelineEntries(timeline.data, kinds, statuses)
  return (
    <div className="space-y-4">
      {entries.length === 0 && !timeline.hasNextPage ? (
        <p className="text-sm text-muted-foreground">{t(kinds?.[0] === 'email' ? 'clients:sheet.emails.empty' : kinds?.[0] === 'call' ? 'clients:sheet.calls.empty' : 'clients:sheet.activity.empty')}</p>
      ) : (
        <Timeline entries={entries} />
      )}
      {timeline.hasNextPage ? (
        <Button type="button" variant="outline" size="sm" disabled={timeline.isFetchingNextPage} onClick={() => void timeline.fetchNextPage()}>
          {t('clients:sheet.activity.more')}
        </Button>
      ) : null}
    </div>
  )
}
