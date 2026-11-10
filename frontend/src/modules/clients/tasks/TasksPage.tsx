import { Headphones, Pencil, Phone, Trash2, FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { RowActions } from '@/shared/components/ui/row-actions'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { TablePagination } from '@/shared/components/ui/table-pagination'
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { useMe } from '@/shared/hooks/use-me'
import { useUrlState } from '@/shared/hooks/use-url-state'
import { api } from '@/shared/lib/api'
import { companyTimeZone, formatDate, formatDateTime, formatNumber } from '@/shared/lib/format'
import { t, type TKey } from '@/shared/lib/i18n'
import { usePageActions } from '@/shared/lib/page-actions'
import { cn } from '@/shared/lib/utils'
import { endOf, meetingOf } from '../sheet/meet/meet-api'
import { useMeetingControls } from '../sheet/meet/use-meeting-controls'
import { companyDay, daysBetween } from '../sheet/schedule-time'
import { TASK_KIND_LABEL } from '../sheet/TasksTab'
import { useWrite } from '../sheet/use-sheet'
import { CompleteTaskDialog, type CompletableTask } from './CompleteTaskDialog'
import { EditTaskDialog, type EditableTask } from './EditTaskDialog'
import { SnippetsDialog } from './SnippetsDialog'
import { TASK_TABS, type TaskPriority, type TaskRow, type TaskScope, type TaskTabKey } from './types'
import { useTaskCounts, useTaskList } from './use-tasks-data'

const TAB_LABEL: Record<TaskTabKey, TKey> = {
  all: 'clients:tasks.tabs.all',
  call: 'clients:tasks.tabs.call',
  email: 'clients:tasks.tabs.email',
  linkedin: 'clients:tasks.tabs.linkedin',
  today: 'clients:tasks.tabs.today',
  overdue: 'clients:tasks.tabs.overdue',
}
const PRIORITY_LABEL: Record<TaskPriority, TKey> = {
  low: 'clients:sheet.schedule.priorities.low',
  medium: 'clients:sheet.schedule.priorities.medium',
  high: 'clients:sheet.schedule.priorities.high',
}

/** Calendar days past the due day in the company's zone; 0 for today and for the future. */
function daysOverdue(dueAt: string): number {
  const zone = companyTimeZone()
  return Math.max(0, daysBetween(companyDay(new Date(dueAt), zone), companyDay(new Date(), zone)))
}

function DueCell({ dueAt, endsAt }: { dueAt: string; endsAt?: Date }) {
  const late = daysOverdue(dueAt)
  return (
    <>
      <span className={cn('block tabular-nums', late > 0 && 'text-warning-text')}>
        {formatDateTime(dueAt)}
        {endsAt ? `–${formatDate(endsAt, { timeStyle: 'short' })}` : ''}
      </span>
      {late > 0 ? <span className="block text-xs text-warning-text">{t('clients:tasks.overdueDays', { count: late, n: formatNumber(late) })}</span> : null}
    </>
  )
}

/** The tab "Task-uri": what is due, across prospects. Ticking a task asks what came out of it. */
export function TasksPageTab() {
  const { can } = useMe()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const write = useWrite()
  const canTeam = can('clienti.repartizare')
  const [tabParam, setTab] = useUrlState('v', 'all')
  const [scopeParam, setScope] = useUrlState('scope', 'mine')
  const tab = (TASK_TABS as readonly string[]).includes(tabParam) ? (tabParam as TaskTabKey) : 'all'
  const scope: TaskScope = canTeam && scopeParam === 'team' ? 'team' : 'mine'
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [completing, setCompleting] = useState<CompletableTask | null>(null)
  const [editing, setEditing] = useState<EditableTask | null>(null)
  const [snippetsOpen, setSnippetsOpen] = useState(false)
  const meetings = useMeetingControls()

  useEffect(() => setPage(0), [tab, scope, pageSize])
  const counts = useTaskCounts(scope)
  const list = useTaskList({ tab, scope, page, pageSize })
  const callCount = counts.data?.call ?? 0
  const startSession = () => navigate(`/clients/tasks/session?scope=${scope}`)

  usePageActions(callCount > 0 ? [{ id: 'tasks-session', label: t('clients:tasks.palette.session'), icon: Headphones, run: startSession }] : [])

  const complete = (task: TaskRow) => setCompleting({ id: task.id, kind: task.kind, title: task.title, prospectId: task.prospectId, prospectName: task.prospectName })
  const remove = (task: TaskRow) =>
    void confirm({ title: t('clients:sheet.tasks.deleteTitle', { title: task.title }), confirmLabel: t('common:actions.delete'), destructive: true }).then(
      (ok) => ok && write(() => api.delete(`/api/prospects/${task.prospectId}/tasks/${task.id}`)),
    )

  const rows = list.data?.rows ?? []
  const total = list.data?.total ?? 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList variant="segmented">
            {TASK_TABS.map((key) => (
              <TabsTrigger key={key} value={key}>
                {t(TAB_LABEL[key])}
                {counts.data ? <span className="ml-1.5 tabular-nums text-muted-foreground">{formatNumber(counts.data[key])}</span> : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
          {canTeam ? (
            <Tabs value={scope} onValueChange={setScope}>
              <TabsList variant="segmented">
                <TabsTrigger value="mine">{t('clients:tasks.scope.mine')}</TabsTrigger>
                <TabsTrigger value="team">{t('clients:tasks.scope.team')}</TabsTrigger>
              </TabsList>
            </Tabs>
          ) : null}
          <Button type="button" variant="outline" onClick={() => setSnippetsOpen(true)}>
            <FileText aria-hidden="true" /> {t('clients:tasks.snippets.open')}
          </Button>
          <Button type="button" onClick={startSession} disabled={callCount === 0}>
            <Phone aria-hidden="true" /> {t('clients:tasks.session.start', { count: callCount, n: formatNumber(callCount) })}
          </Button>
        </div>
      </div>

      {list.isPending ? (
        <ListSkeleton rows={6} />
      ) : list.isError ? (
        <EmptyState kind="filtered" title={t('clients:tasks.loadFailed')} onReset={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        tab === 'all' ? (
          <EmptyState kind="new" title={t('clients:tasks.empty')} description={t('clients:tasks.emptyHint')} />
        ) : (
          <EmptyState kind="filtered" title={t('clients:tasks.emptyTab')} onReset={() => setTab('all')} />
        )
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <span className="sr-only">{t('clients:tasks.done')}</span>
                </TableHead>
                <TableHead>{t('clients:tasks.columns.task')}</TableHead>
                <TableHead priority="md">{t('clients:tasks.columns.prospect')}</TableHead>
                <TableHead priority="lg">{t('clients:tasks.columns.person')}</TableHead>
                <TableHead>{t('clients:tasks.columns.due')}</TableHead>
                <TableHead priority="lg">{t('clients:tasks.columns.priority')}</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">{t('common:labels.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((task) => (
                <TableRow key={task.id}>
                  <TableCell>
                    <Checkbox checked={false} aria-label={t('clients:sheet.next.done', { title: task.title })} onChange={() => complete(task)} />
                  </TableCell>
                  <TableCell className="tbl-fill">
                    <span className="block truncate font-medium">{task.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[
                        t(TASK_KIND_LABEL[task.kind] ?? 'clients:sheet.schedule.kinds.task'),
                        task.kind === 'meeting' ? task.location : null,
                        task.kind === 'meeting' && task.invitees?.length ? t('meetings:row.invitees', { count: task.invitees.length }) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <TableDetails items={[task.prospectName, task.personName, scope === 'team' ? task.assigneeName : null]} />
                  </TableCell>
                  <TableCell priority="md">
                    <Link to={`/clients/${task.prospectId}`} className="block max-w-[16rem] truncate rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {task.prospectName}
                    </Link>
                    {scope === 'team' && task.assigneeName ? <span className="block truncate text-xs text-muted-foreground">{task.assigneeName}</span> : null}
                  </TableCell>
                  <TableCell priority="lg">{task.personName ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    <DueCell dueAt={task.dueAt} endsAt={task.kind === 'meeting' ? endOf(task) : undefined} />
                  </TableCell>
                  <TableCell priority="lg">
                    <Badge variant={task.priority === 'high' ? 'warning' : 'secondary'}>{t(PRIORITY_LABEL[task.priority])}</Badge>
                  </TableCell>
                  <TableCell>
                    <RowActions
                      actions={[]}
                      title={task.title}
                      menu={[
                        task.kind === 'meeting'
                          ? { key: 'edit', icon: Pencil, label: t('meetings:row.move'), onClick: () => meetings.move(meetingOf(task, task.prospectId, task.prospectName)) }
                          : { key: 'edit', icon: Pencil, label: t('common:actions.edit'), onClick: () => setEditing(task) },
                        task.kind === 'meeting'
                          ? { key: 'delete', icon: Trash2, label: t('meetings:row.cancel'), destructive: true, onClick: () => void meetings.cancel(meetingOf(task, task.prospectId, task.prospectName)) }
                          : { key: 'delete', icon: Trash2, label: t('common:actions.delete'), destructive: true, onClick: () => remove(task) },
                      ]}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination page={page} pageSize={pageSize} total={total} onPage={setPage} onPageSize={setPageSize} />
        </>
      )}

      <CompleteTaskDialog task={completing} onOpenChange={(open) => !open && setCompleting(null)} />
      <EditTaskDialog task={editing} onOpenChange={(open) => !open && setEditing(null)} />
      <SnippetsDialog open={snippetsOpen} onOpenChange={setSnippetsOpen} />
      {meetings.dialogs}
    </div>
  )
}
