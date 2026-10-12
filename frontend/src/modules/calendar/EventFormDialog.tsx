import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { TimeInput } from '@/shared/components/ui/time-input'
import { Label } from '@/shared/components/ui/label'
import { Textarea } from '@/shared/components/ui/textarea'
import { api } from '@/shared/lib/api'
import { CHART_COLORS } from '@/shared/lib/chart-colors'
import type { CalendarEvent, CalendarLayer, CalendarOccurrence } from '@/shared/lib/types'
import { memberName, useTeamMembers } from '@/shared/hooks/use-team'
import { useMe } from '@/shared/hooks/use-me'
import { toDatetimeLocalValue, WEEKDAY_LABELS } from './date-utils'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { Select } from '@/shared/components/ui/select'
import { t } from '@/shared/lib/i18n'

const COLORS: string[] = [...CHART_COLORS]
const DEFAULT_COLOR = COLORS[0] ?? '#2a78d6'
const BYDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

// startAt/endAt rămân un singur string "YYYY-MM-DDTHH:mm" (toDatetimeLocalValue) — doar UI-ul
// le arată ca 2 input-uri separate (dată + oră), mai ușor de folosit decât un <input
// type="datetime-local"> unde ambele câmpuri sunt lipite în aceeași casetă mică.
function datePart(value: string): string {
  return value.slice(0, 10)
}
function timePart(value: string): string {
  return value.slice(11, 16) || '09:00'
}
function withDatePart(value: string, date: string): string {
  return `${date}T${timePart(value)}`
}
function withTimePart(value: string, time: string): string {
  return `${datePart(value)}T${time}`
}

type Recurrence = 'none' | 'daily' | 'weekly'

interface EventFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = create. */
  event: CalendarEvent | null
  /** Prefill la creare dintr-un click pe un slot orar din vedere. */
  prefill?: { startAt: Date; endAt: Date } | null
  /** Al cui e evenimentul și ce poate face omul cu el; lipsește la creare. */
  meta?: Pick<CalendarOccurrence, 'access' | 'ownerUserId' | 'ownerName' | 'attendees' | 'isCommon'> | null
  /** Calendarele în care omul poate crea: al lui și cele primite cu „editează". */
  writableCalendars?: CalendarLayer[]
}

function parseRecurrence(rule: string | null): { type: Recurrence; days: Set<string> } {
  if (!rule) return { type: 'none', days: new Set() }
  if (rule.startsWith('FREQ=DAILY')) return { type: 'daily', days: new Set() }
  const match = /BYDAY=([A-Z,]+)/.exec(rule)
  return { type: 'weekly', days: new Set(match?.[1] ? match[1].split(',') : []) }
}

export function EventFormDialog({ open, onOpenChange, event, prefill, meta, writableCalendars = [] }: EventFormDialogProps) {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const { can, session } = useMe()
  const members = useTeamMembers()
  const canCommon = can('calendar.comune')
  // Un calendar primit cu „vede" sau un eveniment comun fără `calendar.comune`: se citește, nu se
  // schimbă (serverul răspunde oricum 403).
  const readOnly = Boolean(event && meta?.access === 'view')
  const [attendeeIds, setAttendeeIds] = useState<Set<string>>(new Set())
  const [calendarOwnerId, setCalendarOwnerId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [recurrence, setRecurrence] = useState<Recurrence>('none')
  const [byDays, setByDays] = useState<Set<string>>(new Set())
  const [recurrenceEndAt, setRecurrenceEndAt] = useState('')
  const [color, setColor] = useState<string>(DEFAULT_COLOR)
  // '' = fără reminder (select), altfel minute ca string — convertit la number/null la salvare.
  const [reminderMinutesBefore, setReminderMinutesBefore] = useState('')

  useEffect(() => {
    if (!open) return
    if (event) {
      setTitle(event.title)
      setDescription(event.description ?? '')
      setLocation(event.location ?? '')
      setStartAt(toDatetimeLocalValue(new Date(event.startAt)))
      setEndAt(toDatetimeLocalValue(new Date(event.endAt)))
      const parsed = parseRecurrence(event.recurrenceRule)
      setRecurrence(parsed.type)
      setByDays(parsed.days)
      setRecurrenceEndAt(event.recurrenceEndAt ? event.recurrenceEndAt.slice(0, 10) : '')
      setColor(event.color ?? DEFAULT_COLOR)
      setReminderMinutesBefore(event.reminderMinutesBefore ? String(event.reminderMinutesBefore) : '')
      setAttendeeIds(new Set((meta?.attendees ?? []).map((a) => a.id)))
      setCalendarOwnerId(meta?.ownerUserId ?? '')
    } else {
      const start = prefill?.startAt ?? new Date()
      const end = prefill?.endAt ?? new Date(start.getTime() + 60 * 60 * 1000)
      setTitle('')
      setDescription('')
      setLocation('')
      setStartAt(toDatetimeLocalValue(start))
      setEndAt(toDatetimeLocalValue(end))
      setRecurrence('none')
      setByDays(new Set())
      setRecurrenceEndAt('')
      setColor(DEFAULT_COLOR)
      setReminderMinutesBefore('')
      setAttendeeIds(new Set())
      setCalendarOwnerId(session?.user.id ?? '')
    }
    // `meta` vine din același click ca `event`, deci nu declanșează singur o resetare.
  }, [open, event, prefill])

  const ownerId = calendarOwnerId || session?.user.id
  const attendeeCandidates = (members.data ?? []).filter((m) => m.status === 'active' && m.id !== ownerId)

  const save = useMutation({
    mutationFn: () => {
      const startDate = new Date(startAt)
      const recurrenceRule =
        recurrence === 'daily'
          ? 'FREQ=DAILY'
          : recurrence === 'weekly'
            ? `FREQ=WEEKLY;BYDAY=${(byDays.size > 0 ? [...byDays] : [BYDAY_CODES[startDate.getDay() === 0 ? 6 : startDate.getDay() - 1] ?? 'MO']).join(',')}`
            : undefined
      const body = {
        title,
        description: description || undefined,
        location: location || undefined,
        startAt: startDate.toISOString(),
        endAt: new Date(endAt).toISOString(),
        recurrenceRule,
        recurrenceEndAt: recurrenceRule && recurrenceEndAt ? new Date(recurrenceEndAt).toISOString() : undefined,
        color,
        reminderMinutesBefore: reminderMinutesBefore ? Number(reminderMinutesBefore) : undefined,
        // Fără `calendar.comune` câmpul nu se trimite deloc: serverul l-ar refuza, chiar gol.
        attendeeUserIds: canCommon ? [...attendeeIds].filter((id) => id !== ownerId) : undefined,
      }
      return event
        ? api.patch<CalendarEvent>(`/api/calendar/events/${event.id}`, {
            ...body,
            recurrenceRule: recurrenceRule ?? null,
            recurrenceEndAt: body.recurrenceEndAt ?? null,
            reminderMinutesBefore: reminderMinutesBefore ? Number(reminderMinutesBefore) : null,
          })
        : api.post<CalendarEvent>('/api/calendar/events', {
            ...body,
            calendarOwnerUserId: ownerId && ownerId !== session?.user.id ? ownerId : undefined,
          })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['calendar'] })
      toast.success(event ? t('calendar:toasts.eventUpdated') : t('calendar:toasts.eventCreated'))
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  // Același interval, dar ca blocare pentru programări: nu apare în calendar ca eveniment,
  // doar scoate orele de pe site.
  const blockForBookings = useMutation({
    mutationFn: () =>
      api.post('/api/booking/blocks', {
        startAt: new Date(startAt).toISOString(),
        endAt: new Date(endAt).toISOString(),
        reason: title.trim() || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['booking'] })
      toast.success(t('calendar:toasts.blockedForBookings'))
      onOpenChange(false)
    },
    onError: () => toast.error(t('calendar:toasts.blockFailed')),
  })

  const remove = useMutation({
    mutationFn: () => api.delete<void>(`/api/calendar/events/${event?.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['calendar'] })
      toast.success(t('calendar:toasts.eventDeleted'))
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{readOnly ? event?.title : event ? t('calendar:event.editTitle') : t('calendar:event.newTitle')}</DialogTitle>
          {event && meta && meta.access !== 'owner' && meta.ownerName ? (
            <p className="text-sm text-muted-foreground">
              {meta.isCommon ? t('calendar:event.sharedCreatedBy', { ownerName: meta.ownerName }) : t('calendar:event.inCalendarOf', { ownerName: meta.ownerName })}
              {readOnly ? t('calendar:event.readOnly') : ''}
            </p>
          ) : null}
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!readOnly) save.mutate()
          }}
        >
          <fieldset disabled={readOnly} className="space-y-4">
            {!event && writableCalendars.length > 1 ? (
              <div className="space-y-2">
                <Label htmlFor="ev-calendar">{t('common:nav.calendar')}</Label>
                <Select id="ev-calendar" value={calendarOwnerId} onValueChange={setCalendarOwnerId}>
                  {writableCalendars.map((cal) => (
                    <option key={cal.userId} value={cal.userId}>
                      {cal.owner ? t('calendar:layers.mine') : t('calendar:layers.calendarOf', { name: cal.name })}
                    </option>
                  ))}
                </Select>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="ev-title">{t('common:labels.title')}</Label>
              <Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            {/* Rânduri separate (nu grid 2 coloane) — date/time input-urile native au o lățime
                minimă proprie pe care n-o respectă la comprimare, ieșeau din dialog când
                Început+Sfârșit împărțeau jumătate de coloană fiecare (mai ales cu AM/PM). */}
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="ev-start-date">{t('calendar:event.start')}</Label>
                <div className="flex gap-2">
                  <Input
                    id="ev-start-date"
                    type="date"
                    className="flex-1"
                    value={datePart(startAt)}
                    onChange={(e) => setStartAt(withDatePart(startAt, e.target.value))}
                    required
                  />
                  <TimeInput
                    id="ev-start-time"
                 
                    className="w-20 shrink-0"
                    value={timePart(startAt)}
                    onChange={(v) => setStartAt(withTimePart(startAt, v))}
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ev-end-date">{t('calendar:event.end')}</Label>
                <div className="flex gap-2">
                  <Input
                    id="ev-end-date"
                    type="date"
                    className="flex-1"
                    value={datePart(endAt)}
                    onChange={(e) => setEndAt(withDatePart(endAt, e.target.value))}
                    required
                  />
                  <TimeInput
                    id="ev-end-time"
                 
                    className="w-20 shrink-0"
                    value={timePart(endAt)}
                    onChange={(v) => setEndAt(withTimePart(endAt, v))}
                    required
                  />
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ev-location">{t('calendar:event.location')}</Label>
              <Input id="ev-location" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ev-description">{t('common:labels.description')}</Label>
              <Textarea id="ev-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ev-recurrence">{t('calendar:event.recurrence')}</Label>
              <Select
                id="ev-recurrence"
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value as Recurrence)}
              >
                <option value="none">{t('calendar:event.noRecurrence')}</option>
                <option value="daily">{t('calendar:event.daily')}</option>
                <option value="weekly">{t('calendar:event.weekly')}</option>
              </Select>
            </div>
            {recurrence === 'weekly' ? (
              <div className="space-y-2">
                <Label>{t('calendar:event.days')}</Label>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAY_LABELS.map((label, i) => {
                    const code = BYDAY_CODES[i] ?? 'MO'
                    const active = byDays.has(code)
                    return (
                      <button
                        key={code}
                        type="button"
                        className={`rounded-md border px-2 py-1 text-xs ${active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                        onClick={() =>
                          setByDays((prev) => {
                            const next = new Set(prev)
                            if (next.has(code)) next.delete(code)
                            else next.add(code)
                            return next
                          })
                        }
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}
            {recurrence !== 'none' ? (
              <div className="space-y-2">
                <Label htmlFor="ev-recurrence-end">{t('calendar:event.recurrenceUntil')}</Label>
                <Input
                  id="ev-recurrence-end"
                  type="date"
                  value={recurrenceEndAt}
                  onChange={(e) => setRecurrenceEndAt(e.target.value)}
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="ev-reminder">{t('calendar:event.reminder')}</Label>
              <Select
                id="ev-reminder"
                value={reminderMinutesBefore}
                onChange={(e) => setReminderMinutesBefore(e.target.value)}
              >
                <option value="">{t('calendar:event.reminderNone')}</option>
                <option value="5">{t('calendar:event.reminder5')}</option>
                <option value="15">{t('calendar:event.reminder15')}</option>
                <option value="30">{t('calendar:event.reminder30')}</option>
                <option value="60">{t('calendar:event.reminder60')}</option>
              </Select>
            </div>
            {canCommon && !readOnly ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{t('calendar:event.attendeesOptional')}</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setAttendeeIds(new Set(attendeeCandidates.map((m) => m.id)))}
                  >
                    {t('calendar:event.wholeTeam')}
                  </Button>
                </div>
                <div className="max-h-36 space-y-1 overflow-y-auto rounded-md border p-2">
                  {attendeeCandidates.length ? (
                    attendeeCandidates.map((m) => (
                      <label key={m.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={attendeeIds.has(m.id)}
                          onChange={(e) =>
                            setAttendeeIds((prev) => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(m.id)
                              else next.delete(m.id)
                              return next
                            })
                          }
                        />
                        {memberName(m)}
                      </label>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground">{t('calendar:event.nobodyElse')}</p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{t('calendar:event.attendeesHint')}</p>
              </div>
            ) : meta?.attendees.length ? (
              <div className="space-y-1">
                <Label>{t('calendar:event.attendees')}</Label>
                <p className="text-sm">{meta.attendees.map((a) => a.name).join(', ')}</p>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label>{t('calendar:event.color')}</Label>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`h-6 w-6 rounded-full border-2 ${color === c ? 'border-foreground' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
          </fieldset>
          {readOnly ? null : (
            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={save.isPending}>
                {save.isPending ? t('common:states.saving') : t('common:actions.save')}
              </Button>
              {event ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={remove.isPending}
                  onClick={() => {
                    void confirm({ title: t('calendar:event.deleteTitle', { title: event.title }), consequence: event.recurrenceRule ? t('calendar:event.deleteRecurringBody') : undefined, confirmLabel: t('calendar:event.deleteConfirm'), destructive: true }).then((ok) => ok && remove.mutate())
                  }}
                >
                  {t('common:actions.delete')}
                </Button>
              ) : can('calendar.programari') ? (
                <Button
                  type="button"
                  variant="outline"
                  title={t('calendar:event.blockOnlyHint')}
                  disabled={blockForBookings.isPending || !startAt || !endAt || new Date(endAt) <= new Date(startAt)}
                  onClick={() => blockForBookings.mutate()}
                >
                  {t('calendar:event.blockOnly')}
                </Button>
              ) : null}
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}
