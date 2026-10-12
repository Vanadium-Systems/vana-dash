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
import { formatCount, parseRoDecimal } from '@/shared/lib/utils'
import { intlTag } from '@/shared/lib/format'

// Panoul „Programări de pe site" (docs/BOOKING.md): ce orar vede vanadium.systems, ce e blocat
// și cine a rezervat. Site-ul primește doar sloturi libere, niciodată titlurile din calendar.

const TZ = 'Europe/Bucharest'
const WEEKDAYS = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică']

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
      toast('Interval deblocat', {
        action: {
          label: 'Anulează',
          onClick: () =>
            void api.post('/api/booking/blocks', { startAt: block.startAt, endAt: block.endAt, reason: block.reason ?? undefined }).then(invalidate),
        },
      })
    },
    onError: () => toast.error('Intervalul nu s-a deblocat. Încearcă din nou.'),
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
        <h2 className="font-medium">Programări de pe site</h2>
        {settings.isPending || preview.isPending ? (
          <Skeleton className="h-5 w-48" />
        ) : !settings.data?.enabled ? (
          <p className="text-muted-foreground">Oprite: vanadium.systems nu arată nicio oră.</p>
        ) : nextSlot ? (
          <p className="text-muted-foreground">
            Următorul slot liber: <span className="text-foreground">{slotLabel(nextSlot.start)}</span> ·{' '}
            {formatCount(preview.data?.slots.length ?? 0, 'slot liber', 'sloturi libere')} în 14 zile
          </p>
        ) : (
          <p className="text-muted-foreground">Niciun slot liber în următoarele 14 zile.</p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs text-muted-foreground">Rezervări viitoare</h3>
        {bookings.isPending ? (
          <Skeleton className="h-8 w-full" />
        ) : bookings.isError ? (
          <p className="text-muted-foreground">Rezervările nu s-au încărcat.</p>
        ) : upcomingBookings.length === 0 ? (
          <p className="text-muted-foreground">Nicio rezervare.</p>
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
        <h3 className="text-xs text-muted-foreground">Intervale blocate</h3>
        {upcomingBlocks.length === 0 ? <p className="text-muted-foreground">Niciun interval blocat.</p> : null}
        <ul className="space-y-1">
          {upcomingBlocks.map((b) => (
            <li key={b.id} className="group flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-mono text-xs tnum">{slotLabel(b.startAt)}</span>
                {b.reason ? <span className="text-muted-foreground"> · {b.reason}</span> : null}
              </span>
              <Button variant="ghost" size="icon-sm" title="Deblochează" disabled={deleteBlock.isPending} onClick={() => deleteBlock.mutate(b)}>
                <Trash2 />
                <span className="sr-only">Deblochează intervalul</span>
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
      toast.success('Interval blocat')
    },
    onError: () => setError('Intervalul nu s-a salvat. Încearcă din nou.'),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const start = new Date(`${date}T${from}`)
    const end = new Date(`${date}T${to}`)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      setError('Ora de sfârșit trebuie să fie după cea de început.')
      return
    }
    setError(null)
    create.mutate({ startAt: start.toISOString(), endAt: end.toISOString(), reason: reason.trim() || undefined })
  }

  return (
    <form onSubmit={submit} className="space-y-2 pt-1">
      <Input ref={dateRef} type="date" aria-label="Ziua" value={date} onChange={(e) => setDate(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <TimeInput aria-label="De la" className="min-w-0" value={from} onChange={setFrom} />
        <TimeInput aria-label="Până la" className="min-w-0" value={to} onChange={setTo} />
      </div>
      <div className="flex gap-2">
        <Input aria-label="Motiv (opțional)" placeholder="Motiv (opțional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button type="submit" variant="outline" disabled={create.isPending}>
          Blochează
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
      toast.success('Orarul de programări e salvat')
    },
    onError: () => toast.error('Orarul nu s-a salvat. Valorile tale au rămas în formular.'),
  })

  const limits: Record<keyof typeof numbers, [number, number, string]> = {
    durationMin: [15, 120, 'Durata e între 15 și 120 de minute'],
    bufferMin: [0, 60, 'Pauza e între 0 și 60 de minute'],
    minNoticeHours: [0, 168, 'Preavizul e între 0 și 168 de ore'],
    horizonDays: [1, 60, 'Orizontul e între 1 și 60 de zile'],
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
      if (r.on && r.end <= r.start) nextErrors[`day-${i}`] = `${WEEKDAYS[i]}: ora de sfârșit trebuie să fie după cea de început`
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
      <h3 className="text-xs text-muted-foreground">Orar</h3>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Arată orele libere pe vanadium.systems
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
              aria-label={`${WEEKDAYS[i]} de la`}
              disabled={!r.on}
              value={r.start}
              onChange={(v) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, start: v } : x)))}
            />
            <TimeInput
             
              className="min-w-0"
              aria-label={`${WEEKDAYS[i]} până la`}
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
        {numberField('durationMin', 'Durata (min)')}
        {numberField('bufferMin', 'Pauză (min)')}
        {numberField('minNoticeHours', 'Preaviz (ore)')}
        {numberField('horizonDays', 'Orizont (zile)')}
      </div>
      <Button type="submit" disabled={save.isPending}>
        Salvează orarul
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
      toast.success('Programarea e anulată')
      onOpenChange(false)
    },
    onError: () => toast.error('Programarea nu s-a anulat. Încearcă din nou.'),
  })

  if (!booking) return null
  const who = [booking.name, booking.company].filter(Boolean).join(', ') || 'Vizitator anonimizat'

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-md" aria-describedby={undefined}>
        <DialogHeader className="pr-6">
          <DialogTitle className="text-base">Apel · {who}</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Când</dt>
          <dd className="font-mono tnum">{slotLabel(booking.start)}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd className="min-w-0 truncate">{booking.email ? <a className="underline underline-offset-2" href={`mailto:${booking.email}`}>{booking.email}</a> : '—'}</dd>
          <dt className="text-muted-foreground">Subiect</dt>
          <dd className="whitespace-pre-wrap">{booking.topic ?? '—'}</dd>
          <dt className="text-muted-foreground">Stare</dt>
          <dd>
            <StatePill tone={booking.status === 'confirmed' ? 'success' : 'neutral'}>{booking.status === 'confirmed' ? 'Confirmată' : 'Anulată'}</StatePill>
          </dd>
        </dl>
        {booking.status === 'confirmed' ? (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              disabled={cancel.isPending}
              onClick={() =>
                void confirm({
                  title: `Anulează fără email apelul cu ${who}`,
                  consequence: 'Pentru rezervări false: ora se eliberează, vizitatorul nu e anunțat.',
                  confirmLabel: 'Anulează fără email',
                  destructive: true,
                }).then((ok) => ok && cancel.mutate({ id: booking.id, notifyVisitor: false }))
              }
            >
              Anulează fără email
            </Button>
            <Button
              variant="outline"
              disabled={cancel.isPending}
              onClick={() =>
                void confirm({
                  title: `Anulează apelul cu ${who}`,
                  consequence: 'Evenimentul dispare din calendar, iar vizitatorul primește un email de anulare.',
                  confirmLabel: 'Anulează programarea',
                  destructive: true,
                }).then((ok) => ok && cancel.mutate({ id: booking.id, notifyVisitor: true }))
              }
            >
              Anulează programarea
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
