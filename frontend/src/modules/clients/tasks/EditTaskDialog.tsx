import { useEffect, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { TimeInput } from '@/shared/components/ui/time-input'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { companyTimeZone } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { useAssignees } from '../prospects/use-prospect-data'
import { companyClock, companyDay, zonedInstant } from '../sheet/schedule-time'
import { useWrite } from '../sheet/use-sheet'
import { SnippetTextarea } from './SnippetTextarea'
import type { TaskPriority } from './types'

export interface EditableTask {
  id: string
  prospectId: string
  title: string
  description: string | null
  dueAt: string
  priority: TaskPriority
  assigneeUserId: string
}

const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high']

export function EditTaskDialog({ task, onOpenChange }: { task: EditableTask | null; onOpenChange: (open: boolean) => void }) {
  const { can } = useMe()
  const write = useWrite()
  const assignees = useAssignees().data ?? []
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('10:00')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [assigneeUserId, setAssigneeUserId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!task) return
    const zone = companyTimeZone()
    setTitle(task.title)
    setDescription(task.description ?? '')
    setDate(companyDay(new Date(task.dueAt), zone))
    setTime(companyClock(task.dueAt, zone))
    setPriority(task.priority)
    setAssigneeUserId(task.assigneeUserId)
    setError(null)
  }, [task])

  const submit = async () => {
    if (!task) return
    if (!title.trim()) return setError(t('clients:sheet.schedule.titleRequired'))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError(t('clients:sheet.schedule.dateRequired'))
    setSaving(true)
    const done = await write(
      () =>
        api.patch(`/api/prospects/${task.prospectId}/tasks/${task.id}`, {
          title: title.trim(),
          description: description.trim() || null,
          dueAt: zonedInstant(date, time, companyTimeZone()).toISOString(),
          priority,
          ...(assigneeUserId !== task.assigneeUserId ? { assigneeUserId } : {}),
        }),
      t('clients:tasks.saved'),
    )
    setSaving(false)
    if (done !== undefined) onOpenChange(false)
  }

  return (
    <Dialog open={task !== null} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('clients:tasks.editTitle')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Field label={t('common:labels.title')} error={error}>
            <Input maxLength={255} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={t('clients:tasks.description')} optional>
            <SnippetTextarea rows={3} maxLength={5000} value={description} onValueChange={setDescription} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('clients:sheet.schedule.date')}>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label={t('clients:sheet.schedule.time')}>
              <TimeInput value={time} onChange={setTime} />
            </Field>
          </div>
          <Field label={t('clients:sheet.schedule.priority')}>
            <Select
              value={priority}
              onValueChange={(next) => setPriority(next as TaskPriority)}
              options={PRIORITIES.map((value) => ({ value, label: t(`clients:sheet.schedule.priorities.${value}`) }))}
            />
          </Field>
          {can('clienti.repartizare') ? (
            <Field label={t('clients:sheet.schedule.assignee')}>
              <Select value={assigneeUserId} onValueChange={setAssigneeUserId}>
                {assignees.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.displayName ?? person.email}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {t('common:actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
