import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
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
import { personTag, TAG_COLORS, tagColor } from '@/shared/lib/tag-colors'
import type { CalendarEvent, CalendarLayer, CalendarOccurrence, SeriesScope } from '@/shared/lib/types'
import { memberName, useTeamMembers } from '@/shared/hooks/use-team'
import { useMe } from '@/shared/hooks/use-me'
import { toDatetimeLocalValue, WEEKDAY_LABELS } from './date-utils'
import { BYDAY_CODES, buildRecurrence, describeRule, parseRecurrence, recurrenceEndInputValue, recurrenceEndIso, type RecurrenceType } from './recurrence'
import { revertableToast } from './calendar-undo'
import { Select } from '@/shared/components/ui/select'
import { t } from '@/shared/lib/i18n'

// Stored as `tag-<n>` (the shared category palette); null = the owner's own colour, as in chat.
const TAG_VALUES = TAG_COLORS.map((n) => `tag-${n}`)

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

const REMINDER_PRESETS = [0, 5, 10, 15, 30, 60, 120, 1440, 10080]
const MAX_REMINDERS = 5

interface EventFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The occurrence being edited; null = create. */
  occurrence: CalendarOccurrence | null
  /** Prefill la creare: intervalul tras pe grilă și ce s-a scris în creare rapidă. */
  prefill?: { startAt: Date; endAt: Date; title?: string } | null
  /** Calendarele în care omul poate crea: al lui și cele primite cu „editează". */
  writableCalendars?: CalendarLayer[]
  /** Jumps the view to a newly created event, which may fall outside the visible period. */
  onShowEvent?: (startAt: Date) => void
  /** Asks "only this / this and following / all" for a series; null = cancelled. */
  requestScope: (action: 'edit') => Promise<SeriesScope | null>
}

function reminderLabel(minutes: number): string {
  if (minutes === 0) return t('calendar:reminders.atStart')
  if (minutes % 10080 === 0) return t('calendar:reminders.weeks', { count: minutes / 10080 })
  if (minutes % 1440 === 0) return t('calendar:reminders.days', { count: minutes / 1440 })
  if (minutes % 60 === 0) return t('calendar:reminders.hours', { count: minutes / 60 })
  return t('calendar:reminders.minutes', { count: minutes })
}

export function EventFormDialog({ open, onOpenChange, occurrence, prefill, writableCalendars = [], onShowEvent, requestScope }: EventFormDialogProps) {
  const queryClient = useQueryClient()
  const { can, session } = useMe()
  const members = useTeamMembers()
  const canCommon = can('calendar.comune')
  // Un calendar primit cu „vede" sau un eveniment comun fără `calendar.comune`: se citește, nu se
  // schimbă (serverul răspunde oricum 403).
  const readOnly = Boolean(occurrence && occurrence.access === 'view')
  const [attendeeIds, setAttendeeIds] = useState<Set<string>>(new Set())
  const [calendarOwnerId, setCalendarOwnerId] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [recurrence, setRecurrence] = useState<RecurrenceType>('none')
  const [byDays, setByDays] = useState<Set<string>>(new Set())
  const [recurrenceInterval, setRecurrenceInterval] = useState('1')
  // The parts of the rule the form does not show, saved back as they were.
  const [recurrenceKept, setRecurrenceKept] = useState<{ rest: string[]; raw: string | null }>({ rest: [], raw: null })
  const [recurrenceEndAt, setRecurrenceEndAt] = useState('')
  const [color, setColor] = useState<string | null>(null)
  const [reminders, setReminders] = useState<number[]>([])

  useEffect(() => {
    if (!open) return
    if (occurrence) {
      // The form shows the occurrence that was clicked; "all events" maps the change back onto the series.
      const start = new Date(occurrence.occurrenceStart)
      setTitle(occurrence.title)
      setDescription(occurrence.description ?? '')
      setLocation(occurrence.location ?? '')
      setStartAt(toDatetimeLocalValue(start))
      setEndAt(toDatetimeLocalValue(new Date(occurrence.occurrenceEnd)))
      const parsed = parseRecurrence(occurrence.recurrenceRule, new Date(occurrence.seriesStart))
      setRecurrence(parsed.type)
      setByDays(new Set(parsed.days))
      setRecurrenceInterval(String(parsed.interval))
      setRecurrenceKept({ rest: parsed.rest, raw: parsed.raw })
      setRecurrenceEndAt(recurrenceEndInputValue(occurrence.recurrenceEndAt))
      setColor(occurrence.color)
      setReminders(occurrence.reminders)
      setAttendeeIds(new Set(occurrence.attendees.map((a) => a.id)))
      setCalendarOwnerId(occurrence.ownerUserId ?? '')
    } else {
      const start = prefill?.startAt ?? new Date()
      const end = prefill?.endAt ?? new Date(start.getTime() + 60 * 60 * 1000)
      setTitle(prefill?.title ?? '')
      setDescription('')
      setLocation('')
      setStartAt(toDatetimeLocalValue(start))
      setEndAt(toDatetimeLocalValue(end))
      setRecurrence('none')
      setByDays(new Set())
      setRecurrenceInterval('1')
      setRecurrenceKept({ rest: [], raw: null })
      setRecurrenceEndAt('')
      setColor(null)
      setReminders([])
      setAttendeeIds(new Set())
      setCalendarOwnerId(session?.user.id ?? '')
    }
  }, [open, occurrence, prefill])

  const ownerId = calendarOwnerId || session?.user.id
  const attendeeCandidates = (members.data ?? []).filter((m) => m.status === 'active' && m.id !== ownerId)
  const startDate = startAt ? new Date(startAt) : new Date()
  const builtRule = buildRecurrence(
    { type: recurrence, interval: Number(recurrenceInterval) || 1, days: [...byDays], rest: recurrenceKept.rest, raw: recurrenceKept.raw },
    startDate,
  )
  const ruleSummary = builtRule ? describeRule(builtRule, startDate, recurrenceEndAt ? new Date(recurrenceEndIso(recurrenceEndAt)) : null) : ''
  const optionLabel = (type: RecurrenceType) =>
    describeRule(buildRecurrence({ type, interval: 1, days: [], rest: [], raw: null }, startDate), startDate)

  const save = useMutation({
    mutationFn: async (): Promise<{ data: CalendarEvent; revertToken: string } | null> => {
      const start = new Date(startAt)
      const end = new Date(endAt)
      const recurrenceEndIsoValue = builtRule && recurrenceEndAt ? recurrenceEndIso(recurrenceEndAt) : null
      const common = {
        title,
        description: description || null,
        location: location || null,
        color,
        reminders,
        // Fără `calendar.comune` câmpul nu se trimite deloc: serverul l-ar refuza, chiar gol.
        attendeeUserIds: canCommon ? [...attendeeIds].filter((id) => id !== ownerId) : undefined,
      }
      if (!occurrence) {
        return api.write<CalendarEvent>('POST', '/api/calendar/events', {
          ...common,
          description: description || undefined,
          location: location || undefined,
          color: color ?? undefined,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          recurrenceRule: builtRule ?? undefined,
          recurrenceEndAt: recurrenceEndIsoValue ?? undefined,
          calendarOwnerUserId: ownerId && ownerId !== session?.user.id ? ownerId : undefined,
        })
      }
      const path = `/api/calendar/events/${occurrence.eventId}`
      if (!occurrence.isRecurring) {
        return api.write<CalendarEvent>('PATCH', path, {
          ...common,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          recurrenceRule: builtRule,
          recurrenceEndAt: recurrenceEndIsoValue,
        })
      }
      const scope = await requestScope('edit')
      if (!scope) return null
      const query = `?scope=${scope}&occurrence=${encodeURIComponent(occurrence.occurrenceKey ?? occurrence.occurrenceStart)}`
      if (scope === 'occurrence') {
        return api.write<CalendarEvent>('PATCH', path + query, {
          title,
          description: description || null,
          location: location || null,
          color,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
        })
      }
      // An unchanged rule is not sent, so the server turns its weekdays when the day moved.
      const ruleChanged = builtRule !== occurrence.recurrenceRule || recurrenceEndIsoValue !== occurrence.recurrenceEndAt
      const rule = ruleChanged ? { recurrenceRule: builtRule, recurrenceEndAt: recurrenceEndIsoValue } : {}
      if (scope === 'following') {
        return api.write<CalendarEvent>('PATCH', path + query, { ...common, ...rule, startAt: start.toISOString(), endAt: end.toISOString() })
      }
      // The whole series moves by as much as this occurrence did.
      const shift = start.getTime() - new Date(occurrence.occurrenceStart).getTime()
      const seriesStart = new Date(new Date(occurrence.seriesStart).getTime() + shift)
      return api.write<CalendarEvent>('PATCH', path + query, {
        ...common,
        ...rule,
        startAt: seriesStart.toISOString(),
        endAt: new Date(seriesStart.getTime() + (end.getTime() - start.getTime())).toISOString(),
      })
    },
    onSuccess: (saved) => {
      if (!saved) return
      void queryClient.invalidateQueries({ queryKey: ['calendar'] })
      revertableToast(
        occurrence ? t('calendar:toasts.eventUpdatedNamed', { title }) : t('calendar:toasts.eventCreatedNamed', { title }),
        saved.revertToken,
        queryClient,
      )
      if (!occurrence) onShowEvent?.(new Date(startAt))
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{readOnly ? occurrence?.title : occurrence ? t('calendar:event.editTitle') : t('calendar:event.newTitle')}</DialogTitle>
          {occurrence && occurrence.access !== 'owner' && occurrence.ownerName ? (
            <p className="text-sm text-muted-foreground">
              {occurrence.isCommon
                ? t('calendar:event.sharedCreatedBy', { ownerName: occurrence.ownerName })
                : t('calendar:event.inCalendarOf', { ownerName: occurrence.ownerName })}
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
            {!occurrence && writableCalendars.length > 1 ? (
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
              <Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus={!occurrence} />
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
                  <TimeInput id="ev-start-time" className="w-20 shrink-0" value={timePart(startAt)} onChange={(v) => setStartAt(withTimePart(startAt, v))} required />
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
                  <TimeInput id="ev-end-time" className="w-20 shrink-0" value={timePart(endAt)} onChange={(v) => setEndAt(withTimePart(endAt, v))} required />
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
              <Select id="ev-recurrence" value={recurrence} onChange={(e) => setRecurrence(e.target.value as RecurrenceType)}>
                <option value="none">{t('calendar:event.noRecurrence')}</option>
                <option value="daily">{optionLabel('daily')}</option>
                <option value="weekdays">{optionLabel('weekdays')}</option>
                <option value="weekly">{t('calendar:event.weekly')}</option>
                <option value="monthlyDate">{optionLabel('monthlyDate')}</option>
                <option value="monthlyWeekday">{optionLabel('monthlyWeekday')}</option>
                <option value="yearly">{optionLabel('yearly')}</option>
                {recurrence === 'custom' ? <option value="custom">{t('calendar:event.customRecurrence')}</option> : null}
              </Select>
              {ruleSummary ? <p className="text-xs text-muted-foreground">{ruleSummary}</p> : null}
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
                        aria-pressed={active}
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
            {recurrence !== 'none' && recurrence !== 'custom' && recurrence !== 'weekdays' ? (
              <div className="space-y-2">
                <Label htmlFor="ev-recurrence-interval">{t('calendar:event.interval')}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="ev-recurrence-interval"
                    inputMode="numeric"
                    className="w-20"
                    value={recurrenceInterval}
                    onChange={(e) => setRecurrenceInterval(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
                  />
                  <span className="text-sm text-muted-foreground">
                    {t(`calendar:event.interval${recurrence === 'daily' ? 'Days' : recurrence === 'weekly' ? 'Weeks' : recurrence === 'yearly' ? 'Years' : 'Months'}`, {
                      count: Number(recurrenceInterval) || 1,
                    })}
                  </span>
                </div>
              </div>
            ) : null}
            {recurrence !== 'none' ? (
              <div className="space-y-2">
                <Label htmlFor="ev-recurrence-end">{t('calendar:event.recurrenceUntil')}</Label>
                <Input id="ev-recurrence-end" type="date" value={recurrenceEndAt} onChange={(e) => setRecurrenceEndAt(e.target.value)} />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label>{t('calendar:reminders.label')}</Label>
              <ul className="space-y-2">
                {reminders.map((minutes, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <Select
                      aria-label={t('calendar:reminders.label')}
                      className="flex-1"
                      value={String(minutes)}
                      onChange={(e) => setReminders((prev) => prev.map((m, i) => (i === index ? Number(e.target.value) : m)))}
                    >
                      {[...new Set([...REMINDER_PRESETS, minutes])]
                        .sort((a, b) => a - b)
                        .map((option) => (
                          <option key={option} value={option} disabled={option !== minutes && reminders.includes(option)}>
                            {reminderLabel(option)}
                          </option>
                        ))}
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('calendar:reminders.remove', { label: reminderLabel(minutes) })}
                      onClick={() => setReminders((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
              {reminders.length < MAX_REMINDERS ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setReminders((prev) => [...prev, REMINDER_PRESETS.find((m) => m >= 10 && !prev.includes(m)) ?? 0])}
                >
                  <Plus className="h-4 w-4" /> {t('calendar:reminders.add')}
                </Button>
              ) : null}
            </div>
            {canCommon && !readOnly ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{t('calendar:event.attendeesOptional')}</Label>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setAttendeeIds(new Set(attendeeCandidates.map((m) => m.id)))}>
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
            ) : occurrence?.attendees.length ? (
              <div className="space-y-1">
                <Label>{t('calendar:event.attendees')}</Label>
                <p className="text-sm">{occurrence.attendees.map((a) => a.name).join(', ')}</p>
              </div>
            ) : !readOnly ? (
              // Without `calendar.comune` an event cannot reach anyone else's calendar; said here so
              // nobody believes they invited a colleague.
              <p className="text-xs text-muted-foreground">{t('calendar:event.onlyYourCalendar')}</p>
            ) : null}
            <div className="space-y-2">
              <Label id="ev-color-label">{t('calendar:event.color')}</Label>
              <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-labelledby="ev-color-label">
                {[null, ...TAG_VALUES, ...(color && !TAG_VALUES.includes(color) ? [color] : [])].map((value) => {
                  const selected = color === value
                  const swatch = value === null ? tagColor(personTag(ownerId ?? '')) : value.startsWith('tag-') ? tagColor(Number(value.slice(4))) : value
                  return (
                    <button
                      key={value ?? 'mine'}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={value === null ? t('calendar:event.colorMine') : t('calendar:event.colorOption', { n: value.startsWith('tag-') ? value.slice(4) : '•' })}
                      title={value === null ? t('calendar:event.colorMine') : undefined}
                      className={`flex h-7 items-center gap-1.5 rounded-full border-2 ${selected ? 'border-foreground' : 'border-transparent'} ${value === null ? 'pl-1 pr-2 text-xs' : 'w-7 justify-center'}`}
                      onClick={() => setColor(value)}
                    >
                      <span className="h-5 w-5 shrink-0 rounded-full" style={{ backgroundColor: swatch }} aria-hidden="true" />
                      {value === null ? t('calendar:event.colorMine') : null}
                    </button>
                  )
                })}
              </div>
            </div>
          </fieldset>
          {readOnly ? null : (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="flex-1" disabled={save.isPending}>
                {save.isPending ? t('common:states.saving') : t('common:actions.save')}
              </Button>
              {!occurrence && can('calendar.programari') ? (
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
