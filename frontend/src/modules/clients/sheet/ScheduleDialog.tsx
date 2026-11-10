import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { TimeInput } from '@/shared/components/ui/time-input'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { companyTimeZone, formatDate } from '@/shared/lib/format'
import { t, type TKey } from '@/shared/lib/i18n'
import type { CalendarOccurrence } from '@/shared/lib/types'
import { useAssignees } from '../prospects/use-prospect-data'
import { SnippetTextarea } from '../tasks/SnippetTextarea'
import { companyDay, dayRange, zonedInstant } from './schedule-time'
import type { ProspectSheet } from './types'
import { useWrite } from './use-sheet'

const KINDS = ['call', 'email', 'meeting', 'task', 'linkedin_connect', 'linkedin_message', 'linkedin_view', 'linkedin_engage'] as const
type Kind = (typeof KINDS)[number]
const PRIORITIES = ['low', 'medium', 'high'] as const
type Priority = (typeof PRIORITIES)[number]

const KIND_LABEL: Record<Kind, TKey> = {
  call: 'clients:sheet.schedule.kinds.call',
  email: 'clients:sheet.schedule.kinds.email',
  meeting: 'clients:sheet.schedule.kinds.meeting',
  task: 'clients:sheet.schedule.kinds.task',
  linkedin_connect: 'clients:sheet.schedule.kinds.linkedin_connect',
  linkedin_message: 'clients:sheet.schedule.kinds.linkedin_message',
  linkedin_view: 'clients:sheet.schedule.kinds.linkedin_view',
  linkedin_engage: 'clients:sheet.schedule.kinds.linkedin_engage',
}

const TITLE_FOR: Record<Kind, TKey> = {
  call: 'clients:sheet.schedule.titleFor.call',
  email: 'clients:sheet.schedule.titleFor.email',
  meeting: 'clients:sheet.schedule.titleFor.meeting',
  task: 'clients:sheet.schedule.titleFor.task',
  linkedin_connect: 'clients:sheet.schedule.titleFor.linkedin_connect',
  linkedin_message: 'clients:sheet.schedule.titleFor.linkedin_message',
  linkedin_view: 'clients:sheet.schedule.titleFor.linkedin_view',
  linkedin_engage: 'clients:sheet.schedule.titleFor.linkedin_engage',
}

const PRIORITY_LABEL: Record<Priority, TKey> = {
  low: 'clients:sheet.schedule.priorities.low',
  medium: 'clients:sheet.schedule.priorities.medium',
  high: 'clients:sheet.schedule.priorities.high',
}

/** The chosen day of my calendar beside the form, so a new call is not put on top of a meeting. */
function DayPreview({ date, time, title }: { date: string; time: string; title: string }) {
  const zone = companyTimeZone()
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date)
  const range = useMemo(() => (valid ? dayRange(date, zone) : null), [valid, date, zone])
  const events = useQuery({
    queryKey: ['calendar', 'day-preview', date],
    queryFn: () => api.get<CalendarOccurrence[]>(`/api/calendar/events?from=${range!.from.toISOString()}&to=${range!.to.toISOString()}`),
    enabled: range !== null,
    staleTime: 30_000,
  })
  const clock = (iso: string) => formatDate(iso, { timeStyle: 'short' })
  const rows = [...(events.data ?? [])].sort((a, b) => a.occurrenceStart.localeCompare(b.occurrenceStart))
  return (
    <aside aria-label={t('clients:sheet.schedule.dayTitle')} className="hidden min-w-0 rounded-md bg-muted/50 p-3 lg:block">
      <h3 className="mb-2 text-sm font-medium">{t('clients:sheet.schedule.dayTitle')}</h3>
      {valid ? <p className="mb-2 text-xs text-muted-foreground">{formatDate(`${date}T12:00:00`, { dateStyle: 'full' })}</p> : null}
      {events.isPending && valid ? (
        <p className="text-xs text-muted-foreground">{t('common:states.loading')}</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {rows.length === 0 ? <li className="text-muted-foreground">{t('clients:sheet.schedule.dayEmpty')}</li> : null}
          {rows.map((event) => (
            <li key={`${event.eventId}-${event.occurrenceStart}`} className="flex gap-2">
              <span className="w-24 shrink-0 text-xs tabular-nums text-muted-foreground">{event.allDay ? t('clients:sheet.schedule.allDay') : `${clock(event.occurrenceStart)}–${clock(event.occurrenceEnd)}`}</span>
              <span className="min-w-0 truncate">{event.title}</span>
            </li>
          ))}
          <li className="flex gap-2 font-medium">
            <span className="w-24 shrink-0 text-xs tabular-nums">{time}</span>
            <span className="min-w-0 truncate">{title || t('clients:sheet.schedule.newTask')}</span>
          </li>
        </ul>
      )}
    </aside>
  )
}

export function ScheduleDialog({ sheet, open, onOpenChange, defaultKind = 'call' }: { sheet: ProspectSheet; open: boolean; onOpenChange: (open: boolean) => void; defaultKind?: Kind }) {
  const { session, can } = useMe()
  const write = useWrite()
  const assignees = useAssignees().data ?? []
  const meId = session?.user.id ?? ''
  const zone = companyTimeZone()
  const calendarOn = can('calendar.view')
  const canAssign = can('clienti.repartizare') || sheet.assignedUserId === meId

  const [kind, setKind] = useState<Kind>(defaultKind)
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('10:00')
  const [priority, setPriority] = useState<Priority>('medium')
  const [assigneeUserId, setAssigneeUserId] = useState(meId)
  const [personId, setPersonId] = useState('')
  const [addToCalendar, setAddToCalendar] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setKind(defaultKind)
    setTitleTouched(false)
    setDescription('')
    setDate(companyDay(new Date(), zone, 1))
    setTime('10:00')
    setPriority('medium')
    setAssigneeUserId(meId)
    setPersonId('')
    setError(null)
  }, [open, defaultKind, meId, zone])

  // The title follows the type until the person writes their own.
  useEffect(() => {
    if (!titleTouched) setTitle(t(TITLE_FOR[kind], { name: sheet.name }))
    setAddToCalendar(kind === 'call' || kind === 'meeting')
  }, [kind, titleTouched, sheet.name])

  const submit = async () => {
    if (!title.trim()) return setError(t('clients:sheet.schedule.titleRequired'))
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError(t('clients:sheet.schedule.dateRequired'))
    setSaving(true)
    const done = await write(
      () =>
        api.post(`/api/prospects/${sheet.id}/tasks`, {
          kind,
          title: title.trim(),
          description: description.trim() || null,
          dueAt: zonedInstant(date, time, zone).toISOString(),
          priority,
          assigneeUserId,
          personId: personId || null,
          addToCalendar: calendarOn && addToCalendar,
        }),
      t('clients:sheet.schedule.created'),
    )
    setSaving(false)
    if (done !== undefined) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-lg lg:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('clients:sheet.schedule.title', { name: sheet.name })}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="grid min-w-0 content-start gap-4">
            <Field label={t('clients:sheet.schedule.kind')}>
              <Select value={kind} onValueChange={(next) => setKind(next as Kind)} options={KINDS.map((value) => ({ value, label: t(KIND_LABEL[value]) }))} />
            </Field>
            <Field label={t('common:labels.title')} error={error}>
              <Input
                maxLength={255}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  setTitleTouched(true)
                }}
              />
            </Field>
            <Field label={t('clients:tasks.description')} optional>
              <SnippetTextarea rows={2} maxLength={5000} value={description} onValueChange={setDescription} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('clients:sheet.schedule.date')}>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label={t('clients:sheet.schedule.time')}>
                <TimeInput value={time} onChange={setTime} />
              </Field>
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">{t('clients:sheet.schedule.priority')}</span>
              <Tabs value={priority} onValueChange={(next) => setPriority(next as Priority)}>
                <TabsList variant="segmented">
                  {PRIORITIES.map((value) => (
                    <TabsTrigger key={value} value={value}>
                      {t(PRIORITY_LABEL[value])}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
            {canAssign ? (
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
            {sheet.people.length > 0 ? (
              <Field label={t('clients:sheet.schedule.person')} optional>
                <Select value={personId} onValueChange={setPersonId}>
                  <option value="">{t('clients:sheet.schedule.noPerson')}</option>
                  {sheet.people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {calendarOn ? (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={addToCalendar} onChange={(e) => setAddToCalendar(e.target.checked)} />
                {t('clients:sheet.schedule.addToCalendar')}
              </label>
            ) : null}
          </div>
          {calendarOn ? <DayPreview date={date} time={time} title={title} /> : null}
          <DialogFooter className="lg:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {t('clients:sheet.schedule.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export type { Kind as ScheduleKind }
