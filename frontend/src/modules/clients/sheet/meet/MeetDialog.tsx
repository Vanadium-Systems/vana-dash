import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { Textarea } from '@/shared/components/ui/textarea'
import { TimeInput } from '@/shared/components/ui/time-input'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { companyTimeZone } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { useAssignees } from '../../prospects/use-prospect-data'
import { companyClock, companyDay, zonedInstant } from '../schedule-time'
import { useSheet, useWrite } from '../use-sheet'
import { DEFAULT_MEETING_MINUTES, defaultMailbox, inviteTexts, useSenderOptions, useSendInvitation, type MeetingTask } from './meet-api'

const DURATIONS = [30, 45, 60, 90]

interface InviteeRow {
  email: string
  label: string
  disabledReason: string | null
}

interface MeetDialogProps {
  prospectId: string
  prospectName: string
  /** Set = move an existing meeting; null = a new one. */
  task: MeetingTask | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** After a move that changed what the invitees were told: the caller asks whether to send the update. */
  onMoved?: (meeting: MeetingTask) => void
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((value) => b.includes(value))

export function MeetDialog({ prospectId, prospectName, task, open, onOpenChange, onMoved }: MeetDialogProps) {
  const { session, can } = useMe()
  const write = useWrite()
  const sendInvitation = useSendInvitation()
  const sheet = useSheet(prospectId, open)
  const colleagues = (useAssignees().data ?? []).filter((person) => person.id !== session?.user.id)
  const zone = companyTimeZone()
  const editing = task !== null
  const canColleagues = can('calendar.comune')
  const canSend = can('email.trimitere')
  const senders = useSenderOptions(open && canSend && !editing)
  const identities = useMemo(() => senders.data?.identities ?? [], [senders.data])
  const organizer = session?.user.displayName ?? session?.user.email ?? ''

  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('10:00')
  const [duration, setDuration] = useState(String(DEFAULT_MEETING_MINUTES))
  const [location, setLocation] = useState('')
  const [invitees, setInvitees] = useState<string[]>([])
  const [attendeeIds, setAttendeeIds] = useState<string[]>([])
  const [sendOn, setSendOn] = useState(true)
  const [from, setFrom] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [textTouched, setTextTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle(task?.title ?? t('meetings:dialog.defaultTitle', { name: prospectName }))
    setDate(task ? companyDay(new Date(task.dueAt), zone) : companyDay(new Date(), zone, 1))
    setTime(task ? companyClock(task.dueAt, zone) : '10:00')
    setDuration(String(task?.durationMinutes ?? DEFAULT_MEETING_MINUTES))
    setLocation(task?.location ?? '')
    setInvitees(task?.invitees ?? [])
    setAttendeeIds(task?.attendeeUserIds ?? [])
    setSendOn(true)
    setTextTouched(false)
    setError(null)
  }, [open, task, prospectName, zone])

  useEffect(() => {
    if (open && !from && identities.length > 0) setFrom(defaultMailbox(identities))
  }, [open, from, identities])

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
  const dueAt = validDate ? zonedInstant(date, time, zone).toISOString() : null

  // The invitation text follows the form until the person edits it.
  useEffect(() => {
    if (!open || editing || textTouched || !dueAt) return
    const texts = inviteTexts('request', { title, dueAt, durationMinutes: Number(duration), location }, organizer)
    setSubject(texts.subject)
    setMessage(texts.body)
  }, [open, editing, textTouched, title, dueAt, duration, location, organizer])

  const rows = useMemo<InviteeRow[]>(() => {
    const people = new Map((sheet.data?.people ?? []).map((person) => [person.id, person]))
    const fromPoints = (sheet.data?.contactPoints ?? [])
      .filter((point) => point.kind === 'email')
      .map((point): InviteeRow => {
        const person = point.personId ? people.get(point.personId) : undefined
        const disabledReason = person?.doNotContact
          ? [t('meetings:dialog.reasons.doNotContact'), person.doNotContactReason].filter(Boolean).join(': ')
          : point.status !== 'ok'
            ? t(`meetings:dialog.reasons.${point.status}`)
            : null
        return { email: point.value.toLowerCase(), label: person?.name ?? t('meetings:dialog.companyAddress'), disabledReason }
      })
    const known = new Set(fromPoints.map((row) => row.email))
    const orphans = (task?.invitees ?? []).filter((email) => !known.has(email)).map((email): InviteeRow => ({ email, label: email, disabledReason: null }))
    return [...fromPoints, ...orphans]
  }, [sheet.data, task])

  const durationOptions = [...new Set([...DURATIONS, Number(duration)])].sort((a, b) => a - b)
  const chosenInvitees = invitees.filter((email) => rows.some((row) => row.email === email && !row.disabledReason))
  const mailboxReady = canSend && identities.length > 0
  const sending = !editing && sendOn && mailboxReady && chosenInvitees.length > 0

  const toggle = (list: string[], setList: (next: string[]) => void, value: string, on: boolean) => setList(on ? [...list, value] : list.filter((entry) => entry !== value))

  const submit = async () => {
    if (!title.trim()) return setError(t('meetings:dialog.titleRequired'))
    if (!dueAt) return setError(t('meetings:dialog.dateRequired'))
    setError(null)
    setSaving(true)
    const common = {
      title: title.trim(),
      dueAt,
      durationMinutes: Number(duration),
      location: location.trim() || null,
    }
    const wantsColleagues = canColleagues ? attendeeIds : undefined
    if (task) {
      const invitesChanged = !sameSet(chosenInvitees, task.invitees)
      const done = await write(
        () =>
          api.patch(`/api/prospects/${prospectId}/tasks/${task.id}`, {
            ...common,
            ...(invitesChanged ? { invitees: chosenInvitees } : {}),
            ...(wantsColleagues && !sameSet(wantsColleagues, task.attendeeUserIds) ? { attendeeUserIds: wantsColleagues } : {}),
          }),
        t('meetings:saved.updated'),
      )
      setSaving(false)
      if (done === undefined) return
      onOpenChange(false)
      const moved = { ...task, ...common, invitees: chosenInvitees, attendeeUserIds: wantsColleagues ?? task.attendeeUserIds }
      const toldChanged = task.title !== common.title || task.dueAt !== new Date(dueAt).toISOString() || (task.durationMinutes ?? DEFAULT_MEETING_MINUTES) !== common.durationMinutes || (task.location ?? null) !== common.location
      if (moved.invitees.length > 0 && (toldChanged || invitesChanged)) onMoved?.(moved)
      return
    }
    const created = await write(
      () =>
        api.post<{ id: string }>(`/api/prospects/${prospectId}/tasks`, {
          kind: 'meeting',
          ...common,
          invitees: chosenInvitees,
          ...(wantsColleagues && wantsColleagues.length > 0 ? { attendeeUserIds: wantsColleagues } : {}),
          addToCalendar: can('calendar.view'),
        }),
      t('meetings:saved.created'),
    )
    setSaving(false)
    if (!created) return
    onOpenChange(false)
    if (sending) await sendInvitation({ prospectId, taskId: created.id, kind: 'request', from, to: chosenInvitees, subject, body: message })
  }

  const sendBlock = () => {
    if (!canSend) return <p className="text-sm text-muted-foreground">{t('meetings:dialog.noSendRight')}</p>
    if (senders.isPending) return null
    if (identities.length === 0) return <p className="text-sm text-muted-foreground">{t('meetings:dialog.noMailbox')}</p>
    return (
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={sendOn} onChange={(e) => setSendOn(e.target.checked)} />
          {t('meetings:dialog.sendInvite')}
        </label>
        {sendOn && chosenInvitees.length === 0 ? <p className="text-xs text-muted-foreground">{t('meetings:dialog.sendInviteNeedsInvitee')}</p> : null}
        {sending ? (
          <>
            <Field label={t('meetings:dialog.from')}>
              <Select
                value={from}
                onValueChange={setFrom}
                options={identities.map((identity) => ({ value: identity.key, label: `${identity.label} (${identity.fromAddress})` }))}
              />
            </Field>
            <Field label={t('meetings:dialog.subject')}>
              <Input
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value)
                  setTextTouched(true)
                }}
              />
            </Field>
            <Field label={t('meetings:dialog.message')}>
              <Textarea
                rows={7}
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value)
                  setTextTouched(true)
                }}
              />
            </Field>
          </>
        ) : null}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{editing ? t('meetings:dialog.editTitle') : t('meetings:dialog.title', { name: prospectName })}</DialogTitle>
          <DialogDescription className="sr-only">{prospectName}</DialogDescription>
        </DialogHeader>
        <form
          className="grid min-w-0 gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Field label={t('common:labels.title')} error={error}>
            <Input maxLength={255} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label={t('meetings:dialog.date')} className="col-span-2 sm:col-span-1">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label={t('meetings:dialog.time')}>
              <TimeInput value={time} onChange={setTime} />
            </Field>
            <Field label={t('meetings:dialog.duration')}>
              <Select value={duration} onValueChange={setDuration} options={durationOptions.map((minutes) => ({ value: String(minutes), label: t('meetings:dialog.minutes', { minutes }) }))} />
            </Field>
          </div>
          <Field label={t('meetings:dialog.location')} optional hint={t('meetings:dialog.locationHint')}>
            <Input maxLength={500} value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>

          <fieldset className="min-w-0 space-y-2">
            <legend className="text-sm font-medium">{t('meetings:dialog.invitees')}</legend>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{sheet.isPending ? t('common:states.loading') : t('meetings:dialog.inviteesEmpty')}</p>
            ) : (
              <ul className="max-h-44 space-y-1.5 overflow-y-auto rounded-md bg-muted/50 p-2">
                {rows.map((row) => (
                  <li key={row.email}>
                    <label className="flex min-w-0 items-start gap-2 text-sm">
                      <Checkbox
                        className="mt-0.5"
                        checked={invitees.includes(row.email) && !row.disabledReason}
                        disabled={row.disabledReason !== null}
                        onChange={(e) => toggle(invitees, setInvitees, row.email, e.target.checked)}
                      />
                      <span className="min-w-0">
                        <span className="block truncate">{row.label}</span>
                        <span className="block break-all text-xs text-muted-foreground">{row.disabledReason ? `${row.email} · ${row.disabledReason}` : row.email}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>

          {canColleagues ? (
            <fieldset className="min-w-0 space-y-2">
              <legend className="text-sm font-medium">{t('meetings:dialog.colleagues')}</legend>
              {colleagues.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('meetings:dialog.colleaguesEmpty')}</p>
              ) : (
                <ul className="max-h-36 space-y-1.5 overflow-y-auto rounded-md bg-muted/50 p-2">
                  {colleagues.map((person) => (
                    <li key={person.id}>
                      <label className="flex min-w-0 items-center gap-2 text-sm">
                        <Checkbox checked={attendeeIds.includes(person.id)} onChange={(e) => toggle(attendeeIds, setAttendeeIds, person.id, e.target.checked)} />
                        <span className="min-w-0 truncate">{person.displayName ?? person.email}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">{t('meetings:dialog.colleaguesHint')}</p>
            </fieldset>
          ) : null}

          {editing ? null : sendBlock()}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {editing ? t('meetings:dialog.save') : sending ? t('meetings:dialog.createAndSend') : t('meetings:dialog.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
