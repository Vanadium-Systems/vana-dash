import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { TimeInput } from '@/shared/components/ui/time-input'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { StatePill } from '@/shared/components/ui/state-pill'
import { api } from '@/shared/lib/api'
import type { BookingBlock, BookingSettings, BookingSlots, BookingSummary } from '@/shared/lib/types'
import { parseRoDecimal } from '@/shared/lib/utils'
import { intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { tNodes } from '@/shared/lib/i18n-nodes'

// Panoul „Programări de pe site" (docs/BOOKING.md): ce orar vede vanadium.systems, ce e blocat
// și cine a rezervat. Site-ul primește doar sloturi libere, niciodată titlurile din calendar.

const TZ = 'Europe/Bucharest'
const WEEKDAYS = [t('common:weekdays.long.mon'), t('common:weekdays.long.tue'), t('common:weekdays.long.wed'), t('common:weekdays.long.thu'), t('common:weekdays.long.fri'), t('common:weekdays.long.sat'), t('common:weekdays.long.sun')]

const slotLabel = (iso: string) =>
  new Intl.DateTimeFormat(intlTag(), { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(iso))

export const bookingKeys = {
  settings: ['booking', 'settings'] as const,
  preview: ['booking', 'preview'] as const,
  blocks: ['booking', 'blocks'] as const,
  bookings: ['booking', 'bookings'] as const,
}

function upcomingRange(days: number) {
  const from = new Date()
  const to = new Date(from.getTime() + days * 86_400_000)
  return `from=${from.toISOString()}&to=${to.toISOString()}`
}

// `enabled`: programările sunt doar ale lui Stefan (`calendar.programari`); fără funcționalitate,
// Calendarul nu le cere deloc, ca un coleg să nu adune 403-uri la fiecare deschidere.
export function useBookingBlocks(enabled = true) {
  return useQuery({
    enabled,
    queryKey: bookingKeys.blocks,
    queryFn: () => api.get<BookingBlock[]>(`/api/booking/blocks?from=${new Date(Date.now() - 60 * 86_400_000).toISOString()}&to=${new Date(Date.now() + 120 * 86_400_000).toISOString()}`),
  })
}

export function useBookingSettings(enabled = true) {
  return useQuery({ enabled, queryKey: bookingKeys.settings, queryFn: () => api.get<BookingSettings>('/api/booking/settings') })
}

export function useBookings(enabled = true) {
  return useQuery({
    enabled,
    queryKey: bookingKeys.bookings,
    queryFn: () => api.get<BookingSummary[]>(`/api/booking/bookings?${upcomingRange(60)}`),
  })
}

/** Șterge un interval blocat, cu „Anulează" în toast (se recreează intervalul). */
export function useDeleteBlock() {
  const queryClient = useQueryClient()
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: bookingKeys.blocks })
    void queryClient.invalidateQueries({ queryKey: bookingKeys.preview })
  }
  return useMutation({
    mutationFn: (block: BookingBlock) => api.delete<void>(`/api/booking/blocks/${block.id}`).then(() => block),
    onSuccess: (block) => {
      invalidate()
      toast(t('calendar:booking.blocks.unblocked'), {
        action: {
          label: t('calendar:booking.undo'),
          onClick: () =>
            void api.post('/api/booking/blocks', { startAt: block.startAt, endAt: block.endAt, reason: block.reason ?? undefined }).then(invalidate),
        },
      })
    },
    onError: () => toast.error(t('calendar:booking.blocks.unblockFailed')),
  })
}

export function BookingPanel({ focusBlockForm, onBookingClick }: { focusBlockForm?: boolean; onBookingClick: (booking: BookingSummary) => void }) {
  const settings = useBookingSettings()
  const preview = useQuery({
    queryKey: bookingKeys.preview,
    queryFn: () => api.get<BookingSlots>('/api/booking/preview?days=14'),
  })
  const blocks = useBookingBlocks()
  const bookings = useBookings()
  const deleteBlock = useDeleteBlock()

  const upcomingBlocks = (blocks.data ?? []).filter((b) => new Date(b.endAt).getTime() > Date.now())
  const upcomingBookings = (bookings.data ?? []).filter((b) => b.status === 'confirmed')
  const nextSlot = preview.data?.slots[0]

  return (
    <div className="space-y-6 text-sm">
      <section className="space-y-1">
        <h2 className="font-medium">{t('calendar:booking.fromSite')}</h2>
        {settings.isPending || preview.isPending ? (
          <Skeleton className="h-5 w-48" />
        ) : !settings.data?.enabled ? (
          <p className="text-muted-foreground">{t('calendar:booking.off')}</p>
        ) : nextSlot ? (
          <p className="text-muted-foreground">
            {tNodes('calendar:booking.nextSlot', {
              slot: <span className="text-foreground">{slotLabel(nextSlot.start)}</span>,
              free: t('calendar:booking.freeSlots', { count: preview.data?.slots.length ?? 0 }),
            })}
          </p>
        ) : (
          <p className="text-muted-foreground">{t('calendar:booking.noFreeSlot')}</p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs text-muted-foreground">{t('calendar:booking.upcoming')}</h3>
        {bookings.isPending ? (
          <Skeleton className="h-8 w-full" />
        ) : bookings.isError ? (
          <p className="text-muted-foreground">{t('calendar:booking.loadFailed')}</p>
        ) : upcomingBookings.length === 0 ? (
          <p className="text-muted-foreground">{t('calendar:booking.none')}</p>
        ) : (
          <ul className="space-y-1">
            {upcomingBookings.map((b) => (
              <li key={b.id}>
                <button type="button" className="w-full rounded-sm px-1 py-1 text-left hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onBookingClick(b)}>
                  <span className="font-mono text-xs text-muted-foreground tnum">{slotLabel(b.start)}</span>
                  <span className="block truncate">{[b.name, b.company].filter(Boolean).join(', ')}</span>
                  {b.email ? <span className="block truncate text-xs text-muted-foreground">{b.email}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs text-muted-foreground">{t('calendar:booking.blocks.title')}</h3>
        {upcomingBlocks.length === 0 ? <p className="text-muted-foreground">{t('calendar:booking.blocks.none')}</p> : null}
        <ul className="space-y-1">
          {upcomingBlocks.map((b) => (
            <li key={b.id} className="group flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-mono text-xs tnum">{slotLabel(b.startAt)}</span>
                {b.reason ? <span className="text-muted-foreground"> · {b.reason}</span> : null}
              </span>
              <Button variant="ghost" size="icon-sm" title={t('common:actions.unblock')} disabled={deleteBlock.isPending} onClick={() => deleteBlock.mutate(b)}>
                <Trash2 />
                <span className="sr-only">{t('calendar:booking.blocks.unblock')}</span>
              </Button>
            </li>
          ))}
        </ul>
        <BlockForm autoFocus={focusBlockForm} />
      </section>

      {settings.data ? <SettingsForm settings={settings.data} /> : null}
    </div>
  )
}

function localDateInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function BlockForm({ autoFocus }: { autoFocus?: boolean }) {
  const queryClient = useQueryClient()
  const dateRef = useRef<HTMLInputElement>(null)
  const [date, setDate] = useState(() => localDateInput(new Date()))
  const [from, setFrom] = useState('10:00')
  const [to, setTo] = useState('12:00')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (autoFocus) dateRef.current?.focus()
  }, [autoFocus])

  const create = useMutation({
    mutationFn: (body: { startAt: string; endAt: string; reason?: string }) => api.post<BookingBlock>('/api/booking/blocks', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: bookingKeys.blocks })
      void queryClient.invalidateQueries({ queryKey: bookingKeys.preview })
      setReason('')
      toast.success(t('calendar:booking.blocks.blocked'))
    },
    onError: () => setError(t('calendar:booking.blocks.saveFailed')),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const start = new Date(`${date}T${from}`)
    const end = new Date(`${date}T${to}`)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      setError(t('calendar:booking.endAfterStart'))
      return
    }
    setError(null)
    create.mutate({ startAt: start.toISOString(), endAt: end.toISOString(), reason: reason.trim() || undefined })
  }

  return (
    <form onSubmit={submit} className="space-y-2 pt-1">
      <Input ref={dateRef} type="date" aria-label={t('calendar:booking.day')} value={date} onChange={(e) => setDate(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <TimeInput aria-label={t('common:labels.from')} className="min-w-0" value={from} onChange={setFrom} />
        <TimeInput aria-label={t('common:labels.until')} className="min-w-0" value={to} onChange={setTo} />
      </div>
      <div className="flex gap-2">
        <Input aria-label={t('calendar:booking.reasonOptional')} placeholder={t('calendar:booking.reasonOptional')} value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button type="submit" variant="outline" disabled={create.isPending}>
          {t('common:actions.block')}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive-text">{error}</p> : null}
    </form>
  )
}

interface DayRow {
  on: boolean
  start: string
  end: string
}

function toRows(settings: BookingSettings): DayRow[] {
  return WEEKDAYS.map((_, i) => {
    const window = settings.weekly.find((w) => w.weekday === i + 1)
    return window ? { on: true, start: window.start, end: window.end } : { on: false, start: '10:00', end: '16:00' }
  })
}

function SettingsForm({ settings }: { settings: BookingSettings }) {
  const queryClient = useQueryClient()
  const [enabled, setEnabled] = useState(settings.enabled)
  const [rows, setRows] = useState(() => toRows(settings))
  const [numbers, setNumbers] = useState({
    durationMin: String(settings.durationMin),
    bufferMin: String(settings.bufferMin),
    minNoticeHours: String(settings.minNoticeHours),
    horizonDays: String(settings.horizonDays),
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    setEnabled(settings.enabled)
    setRows(toRows(settings))
  }, [settings])

  const save = useMutation({
    mutationFn: (next: BookingSettings) => api.put<BookingSettings>('/api/booking/settings', next),
    onSuccess: (data) => {
      queryClient.setQueryData(bookingKeys.settings, data)
      void queryClient.invalidateQueries({ queryKey: bookingKeys.preview })
      toast.success(t('calendar:booking.schedule.saved'))
    },
    onError: () => toast.error(t('calendar:booking.schedule.saveFailed')),
  })

  const limits: Record<keyof typeof numbers, [number, number, string]> = {
    durationMin: [15, 120, t('calendar:booking.schedule.durationRange')],
    bufferMin: [0, 60, t('calendar:booking.schedule.bufferRange')],
    minNoticeHours: [0, 168, t('calendar:booking.schedule.noticeRange')],
    horizonDays: [1, 60, t('calendar:booking.schedule.horizonRange')],
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const nextErrors: Record<string, string> = {}
    const parsed = {} as Record<keyof typeof numbers, number>
    for (const key of Object.keys(numbers) as Array<keyof typeof numbers>) {
      const value = parseRoDecimal(numbers[key])
      const [min, max, message] = limits[key]
      if (!Number.isInteger(value) || value < min || value > max) nextErrors[key] = message
      parsed[key] = value
    }
    rows.forEach((r, i) => {
      if (r.on && r.end <= r.start) nextErrors[`day-${i}`] = t('calendar:booking.schedule.dayEndAfterStart', { value: WEEKDAYS[i] })
    })
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    save.mutate({
      enabled,
      ...parsed,
      weekly: rows.flatMap((r, i) => (r.on ? [{ weekday: i + 1, start: r.start, end: r.end }] : [])),
    })
  }

  const numberField = (key: keyof typeof numbers, label: string) => (
    <Field label={label} error={errors[key]}>
      <Input inputMode="numeric" value={numbers[key]} onChange={(e) => setNumbers((n) => ({ ...n, [key]: e.target.value }))} />
    </Field>
  )

  return (
    <form onSubmit={submit} className="space-y-4">
      <h3 className="text-xs text-muted-foreground">{t('calendar:booking.schedule.title')}</h3>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        {t('calendar:booking.schedule.showOnSite')}
      </label>
      <div className="space-y-1">
        {rows.map((r, i) => (
          <div key={WEEKDAYS[i]} className="grid grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={r.on} onChange={(e) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
              {WEEKDAYS[i]}
            </label>
            <TimeInput
             
              className="min-w-0"
              aria-label={t('calendar:booking.schedule.dayFrom', { value: WEEKDAYS[i] })}
              disabled={!r.on}
              value={r.start}
              onChange={(v) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, start: v } : x)))}
            />
            <TimeInput
             
              className="min-w-0"
              aria-label={t('calendar:booking.schedule.dayUntil', { value: WEEKDAYS[i] })}
              disabled={!r.on}
              value={r.end}
              onChange={(v) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, end: v } : x)))}
            />
          </div>
        ))}
        {Object.entries(errors)
          .filter(([key]) => key.startsWith('day-'))
          .map(([key, message]) => (
            <p key={key} className="text-xs text-destructive-text">
              {message}
            </p>
          ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {numberField('durationMin', t('calendar:booking.schedule.duration'))}
        {numberField('bufferMin', t('calendar:booking.schedule.buffer'))}
        {numberField('minNoticeHours', t('calendar:booking.schedule.notice'))}
        {numberField('horizonDays', t('calendar:booking.schedule.horizon'))}
      </div>
      <Button type="submit" disabled={save.isPending}>
        {t('calendar:booking.schedule.save')}
      </Button>
    </form>
  )
}

export function BookingDetailDialog({ booking, onOpenChange }: { booking: BookingSummary | null; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const cancel = useMutation({
    mutationFn: ({ id, notifyVisitor }: { id: string; notifyVisitor: boolean }) => api.post(`/api/booking/bookings/${id}/cancel`, { notifyVisitor }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['booking'] })
      void queryClient.invalidateQueries({ queryKey: ['calendar'] })
      toast.success(t('calendar:booking.cancelled'))
      onOpenChange(false)
    },
    onError: () => toast.error(t('calendar:booking.cancelFailed')),
  })

  if (!booking) return null
  const who = [booking.name, booking.company].filter(Boolean).join(', ') || t('calendar:booking.anonymizedVisitor')

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-md" aria-describedby={undefined}>
        <DialogHeader className="pr-6">
          <DialogTitle className="text-base">{t('calendar:booking.call', { who })}</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted-foreground">{t('common:labels.when')}</dt>
          <dd className="font-mono tnum">{slotLabel(booking.start)}</dd>
          <dt className="text-muted-foreground">{t('common:labels.email')}</dt>
          <dd className="min-w-0 truncate">{booking.email ? <a className="underline underline-offset-2" href={`mailto:${booking.email}`}>{booking.email}</a> : '—'}</dd>
          <dt className="text-muted-foreground">{t('common:labels.subject')}</dt>
          <dd className="whitespace-pre-wrap">{booking.topic ?? '—'}</dd>
          <dt className="text-muted-foreground">{t('common:labels.state')}</dt>
          <dd>
            <StatePill tone={booking.status === 'confirmed' ? 'success' : 'neutral'}>{booking.status === 'confirmed' ? t('calendar:booking.statusConfirmed') : t('calendar:booking.statusCancelled')}</StatePill>
          </dd>
        </dl>
        {booking.status === 'confirmed' ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              disabled={cancel.isPending}
              onClick={() =>
                void confirm({
                  title: t('calendar:booking.cancelSilentTitle', { who }),
                  consequence: t('calendar:booking.cancelSilentBody'),
                  confirmLabel: t('calendar:booking.cancelSilent'),
                  destructive: true,
                }).then((ok) => ok && cancel.mutate({ id: booking.id, notifyVisitor: false }))
              }
            >
              {t('calendar:booking.cancelSilent')}
            </Button>
            <Button
              variant="outline"
              disabled={cancel.isPending}
              onClick={() =>
                void confirm({
                  title: t('calendar:booking.cancelTitle', { who }),
                  consequence: t('calendar:booking.cancelBody'),
                  confirmLabel: t('calendar:booking.cancel'),
                  destructive: true,
                }).then((ok) => ok && cancel.mutate({ id: booking.id, notifyVisitor: true }))
              }
            >
              {t('calendar:booking.cancel')}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
