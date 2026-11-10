import { CalendarClock, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { formatDateTime } from '@/shared/lib/format'
import { t, type TKey } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import { CompleteTaskDialog, type CompletableTask } from '../tasks/CompleteTaskDialog'
import { EditTaskDialog, type EditableTask } from '../tasks/EditTaskDialog'
import type { SheetTask } from './types'
import { useTasks, useWrite } from './use-sheet'

export const TASK_KIND_LABEL: Record<string, TKey> = {
  call: 'clients:sheet.schedule.kinds.call',
  email: 'clients:sheet.schedule.kinds.email',
  meeting: 'clients:sheet.schedule.kinds.meeting',
  task: 'clients:sheet.schedule.kinds.task',
  linkedin_connect: 'clients:sheet.schedule.kinds.linkedin_connect',
  linkedin_message: 'clients:sheet.schedule.kinds.linkedin_message',
  linkedin_view: 'clients:sheet.schedule.kinds.linkedin_view',
  linkedin_engage: 'clients:sheet.schedule.kinds.linkedin_engage',
}

export const isOpenTask = (task: SheetTask) => !task.doneAt && !task.skippedAt

export function TasksTab({ prospectId, prospectName, canEdit, onSchedule }: { prospectId: string; prospectName: string; canEdit: boolean; onSchedule: () => void }) {
  const { session } = useMe()
  const confirm = useConfirm()
  const write = useWrite()
  const tasks = useTasks(prospectId)
  const [completing, setCompleting] = useState<CompletableTask | null>(null)
  const [editing, setEditing] = useState<EditableTask | null>(null)
  if (tasks.isPending) return <ListSkeleton rows={3} />
  const rows = tasks.data ?? []

  const row = (task: SheetTask) => {
    const open = isOpenTask(task)
    const overdue = open && new Date(task.dueAt).getTime() < Date.now()
    const canTick = canEdit || task.assigneeUserId === session?.user.id
    return (
      <li key={task.id} className="group flex items-center gap-3 text-sm">
        <Checkbox
          checked={!open}
          disabled={!open || !canTick}
          aria-label={t('clients:sheet.next.done', { title: task.title })}
          onChange={() => setCompleting({ id: task.id, kind: task.kind, title: task.title, prospectId, prospectName })}
        />
        <div className="min-w-0 flex-1">
          <p className={cn('truncate', !open && 'text-muted-foreground line-through')}>{task.title}</p>
          <p className={cn('truncate text-xs', overdue ? 'text-destructive-text' : 'text-muted-foreground')}>
            {[t(TASK_KIND_LABEL[task.kind] ?? 'clients:sheet.schedule.kinds.task'), formatDateTime(task.dueAt), task.assigneeName, task.personName].filter(Boolean).join(' · ')}
          </p>
        </div>
        {canEdit && open ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
            aria-label={t('common:actions.edit')}
            title={t('common:actions.edit')}
            onClick={() => setEditing({ id: task.id, prospectId, title: task.title, description: task.description, dueAt: task.dueAt, priority: task.priority, assigneeUserId: task.assigneeUserId })}
          >
            <Pencil />
          </Button>
        ) : null}
        {canEdit && open ? (
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
            aria-label={t('common:actions.delete')}
            title={t('common:actions.delete')}
            onClick={() =>
              void confirm({ title: t('clients:sheet.tasks.deleteTitle', { title: task.title }), confirmLabel: t('common:actions.delete'), destructive: true }).then(
                (ok) => ok && write(() => api.delete(`/api/prospects/${prospectId}/tasks/${task.id}`)),
              )
            }
          >
            <Trash2 />
          </Button>
        ) : null}
      </li>
    )
  }

  return (
    <div className="space-y-4">
      {canEdit ? (
        <Button type="button" variant="outline" size="sm" onClick={onSchedule}>
          <CalendarClock aria-hidden="true" /> {t('clients:sheet.next.schedule')}
        </Button>
      ) : null}
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t('clients:sheet.tasks.empty')}</p> : <ul className="space-y-3">{rows.map(row)}</ul>}
      <CompleteTaskDialog task={completing} onOpenChange={(open) => !open && setCompleting(null)} />
      <EditTaskDialog task={editing} onOpenChange={(open) => !open && setEditing(null)} />
    </div>
  )
}
