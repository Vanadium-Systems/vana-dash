import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, ChevronLeft, ChevronRight, Plus, Users } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { AccessShareDialog } from '@/shared/components/AccessShareDialog'
import { PageHeader } from '@/shared/components/PageHeader'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { api } from '@/shared/lib/api'
import type { AccessLevel, BookingSummary, CalendarEvent, CalendarLayer, CalendarOccurrence, CalendarsPayload } from '@/shared/lib/types'
import { BookingDetailDialog, BookingPanel, useBookingBlocks, useBookings, useBookingSettings, useDeleteBlock } from './BookingPanel'
import { addDays, addMonths, MONTH_LABELS, startOfMonth, startOfWeek } from './date-utils'
import { useMe } from '@/shared/hooks/use-me'
import { EventFormDialog } from './EventFormDialog'
import { MonthView } from './MonthView'
import { WeekView, type TimeRange } from './WeekView'
import { useConsumeParam } from '@/shared/hooks/use-consume-param'
import { t } from '@/shared/lib/i18n'

type ViewMode = 'week' | 'month'

// Straturile bifate țin de om și de device, nu de URL: se aleg o dată și rămân.
const LAYERS_KEY = 'calendar-shown-layers'

function readShownLayers(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(LAYERS_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

/** Implicit se vede doar calendarul omului; cele partajate se bifează. */
function isLayerVisible(layer: CalendarLayer, shown: Set<string>): boolean {
  return layer.owner || shown.has(layer.userId)
}

function occurrenceToEvent(occ: CalendarOccurrence): CalendarEvent {
  return {
    id: occ.eventId,
    title: occ.title,
    description: occ.description,
    location: occ.location,
    startAt: occ.occurrenceStart,
    endAt: occ.occurrenceEnd,
    allDay: occ.allDay,
    recurrenceRule: occ.recurrenceRule,
    recurrenceEndAt: occ.recurrenceEndAt,
    color: occ.color,
    reminderMinutesBefore: occ.reminderMinutesBefore,
    reminderSentAt: null,
  }
}

export function CalendarPage() {
  const { can, session } = useMe()
  const myId = session?.user.id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [view, setView] = useState<ViewMode>('week')
  const [anchor, setAnchor] = useState(new Date())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null)
  const [prefill, setPrefill] = useState<{ startAt: Date; endAt: Date } | null>(null)
  const [bookingDetail, setBookingDetail] = useState<BookingSummary | null>(null)
  const [panelOpenMobile, setPanelOpenMobile] = useState(false)
  const [focusBlockForm, setFocusBlockForm] = useState(false)
  const canBookings = can('calendar.programari')
  const bookingSettings = useBookingSettings(canBookings)
  const bookingBlocks = useBookingBlocks(canBookings)
  const bookings = useBookings(canBookings)
  const deleteBlock = useDeleteBlock()
  const [editingMeta, setEditingMeta] = useState<CalendarOccurrence | null>(null)
  const [shareOpen, setShareOpen] = useState(false)
  // Calendarele partajate bifate; al omului e mereu la vedere, deci lista implicită e goală.
  const [shownLayers, setShownLayers] = useState<Set<string>>(readShownLayers)

  const calendars = useQuery({
    queryKey: ['calendar', 'calendars'],
    queryFn: () => api.get<CalendarsPayload>('/api/calendar/calendars'),
    staleTime: 60 * 1000,
  })
  // `calendar.administrare` vede toate calendarele: oamenii fără share vin ca straturi „vede".
  const layers: CalendarLayer[] = [
    ...(calendars.data?.mine ?? []),
    ...(can('calendar.administrare')
      ? (calendars.data?.members ?? [])
          .filter((m) => !calendars.data?.mine.some((l) => l.userId === m.id))
          .map((m) => ({ userId: m.id, name: m.displayName ?? m.email, level: 'view' as const, owner: false }))
      : []),
  ]
  const writableCalendars = layers.filter((l) => l.level === 'edit')

  function toggleLayer(userId: string, visible: boolean) {
    setShownLayers((prev) => {
      const next = new Set(prev)
      if (visible) next.add(userId)
      else next.delete(userId)
      try {
        localStorage.setItem(LAYERS_KEY, JSON.stringify([...next]))
      } catch {
        // Fără storage (fereastră privată) bifa ține doar până la reîncărcare.
      }
      return next
    })
  }

  // Ctrl K → un eveniment găsit: deschide săptămâna lui.
  useConsumeParam('date', (value) => {
    const day = new Date(`${value}T12:00:00`)
    if (!Number.isNaN(day.getTime())) {
      setAnchor(day)
      setView('week')
    }
  })

  // Ctrl K → „Blochează interval pentru programări": deschide panoul cu formularul în focus.
  useConsumeParam('block', () => {
    setFocusBlockForm(true)
    if (!window.matchMedia('(min-width: 1024px)').matches) setPanelOpenMobile(true)
  })

  const weekStart = startOfWeek(anchor)
  const rangeStart = view === 'week' ? weekStart : startOfWeek(startOfMonth(anchor))
  const rangeEnd = view === 'week' ? addDays(weekStart, 7) : addDays(rangeStart, 42)

  const occurrences = useQuery({
    queryKey: ['calendar', 'events', rangeStart.toISOString(), rangeEnd.toISOString()],
    queryFn: () =>
      api.get<CalendarOccurrence[]>(`/api/calendar/events?from=${rangeStart.toISOString()}&to=${rangeEnd.toISOString()}`),
  })

  const visibleOccurrences = (occurrences.data ?? []).filter((occ) => {
    if (!occ.ownerUserId) return true // cheltuieli recurente: ale firmei, fără calendar
    const layer = layers.find((l) => l.userId === occ.ownerUserId)
    if (layer ? isLayerVisible(layer, shownLayers) : false) return true
    // Un eveniment comun la care omul e participant stă în calendarul lui, oricare ar fi creatorul.
    return Boolean(myId && occ.attendees.some((a) => a.id === myId))
  })

  const shares = calendars.data?.given
  const setShare = useMutation({
    mutationFn: ({ userId, level }: { userId: string; level: AccessLevel }) =>
      api.post('/api/calendar/shares', { ownerUserId: myId, userId, level }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['calendar', 'calendars'] })
      toast.success(t('calendar:toasts.accessSaved'))
    },
    onError: (err) => toast.error(err.message),
  })
  const removeShare = useMutation({
    mutationFn: (userId: string) => api.delete(`/api/calendar/shares/${myId}/${userId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['calendar', 'calendars'] })
      toast.success(t('calendar:toasts.accessRemoved'))
    },
    onError: (err) => toast.error(err.message),
  })

  const moveEvent = useMutation({
    mutationFn: ({ occ, start, end }: { occ: CalendarOccurrence; start: Date; end: Date }) =>
      api.patch<CalendarEvent>(`/api/calendar/events/${occ.eventId}`, {
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['calendar'] })
      toast.success(t('calendar:toasts.eventMoved'))
    },
    onError: (err) => toast.error(err.message),
  })

  const openCreate = (start: Date, end: Date) => {
    if (!can('calendar.editare')) return
    setEditingEvent(null)
    setEditingMeta(null)
    setPrefill({ startAt: start, endAt: end })
    setDialogOpen(true)
  }

  useConsumeParam('new', () => {
    const start = new Date()
    start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0)
    openCreate(start, new Date(start.getTime() + 60 * 60 * 1000))
  })

  const openEdit = async (occ: CalendarOccurrence) => {
    if (occ.source === 'booking') {
      // useBookings aduce doar de acum încolo; o programare deja trecută (sau de mai devreme azi)
      // se cere separat pe intervalul ei, altfel clickul cădea în formularul de eveniment, fără email.
      const cached = bookings.data?.find((b) => b.calendarEventId === occ.eventId)
      const booking =
        cached ??
        (
          await api
            .get<BookingSummary[]>(`/api/booking/bookings?from=${occ.occurrenceStart}&to=${occ.occurrenceEnd}`)
            .catch(() => [])
        ).find((b) => b.calendarEventId === occ.eventId)
      if (booking) {
        setBookingDetail(booking)
        return
      }
    }
    if (occ.kind === 'expense') {
      // Ocurență virtuală din recurring_expenses — nu există în calendar_events, needitabilă
      // din formularul de eveniment. Editarea reală se face din Accounting.
      toast.info(t('calendar:toasts.recurringExpenseHint'), { description: occ.title.replace(/^Plată: /, '') })
      navigate('/accounting?tab=primite')
      return
    }
    setEditingEvent(occurrenceToEvent(occ))
    setEditingMeta(occ)
    setPrefill(null)
    setDialogOpen(true)
  }

  // Orele de programări (ora din București = ora browserului lui Stefan) întinse pe săptămâna afișată.
  const bookingWindows: TimeRange[] = canBookings && bookingSettings.data?.enabled
    ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).flatMap((day) => {
        const weekday = day.getDay() === 0 ? 7 : day.getDay()
        return bookingSettings.data!.weekly
          .filter((w) => w.weekday === weekday)
          .map((w) => {
            const [sh, sm] = w.start.split(':').map(Number)
            const [eh, em] = w.end.split(':').map(Number)
            const start = new Date(day)
            start.setHours(sh ?? 0, sm ?? 0, 0, 0)
            const end = new Date(day)
            end.setHours(eh ?? 0, em ?? 0, 0, 0)
            return { start, end }
          })
      })
    : []

  const panel = <BookingPanel focusBlockForm={focusBlockForm} onBookingClick={setBookingDetail} />

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('common:nav.calendar')}
        actions={
          <>
            <div className="flex rounded-md border">
              <Button variant={view === 'week' ? 'default' : 'ghost'} onClick={() => setView('week')}>
                {t('calendar:view.week')}
              </Button>
              <Button variant={view === 'month' ? 'default' : 'ghost'} onClick={() => setView('month')}>
                {t('calendar:view.month')}
              </Button>
            </div>
            {myId ? (
              <Button variant="outline" onClick={() => setShareOpen(true)}>
                <Users className="h-4 w-4" /> {t('common:actions.share')}
              </Button>
            ) : null}
            {can('calendar.editare') ? (
              <Button
                onClick={() => {
                  const start = new Date()
                  start.setMinutes(0, 0, 0)
                  openCreate(start, new Date(start.getTime() + 60 * 60 * 1000))
                }}
              >
                <Plus className="h-4 w-4" /> {t('calendar:event.newTitle')}
              </Button>
            ) : null}
            {canBookings ? (
              <Button variant="outline" className="lg:hidden" onClick={() => setPanelOpenMobile(true)}>
                <CalendarClock className="h-4 w-4" /> {t('calendar:booking.short')}
              </Button>
            ) : null}
          </>
        }
      />

      <div className={canBookings ? 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]' : undefined}>
        <div className="min-w-0 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                aria-label={view === 'week' ? t('calendar:nav.previousWeek') : t('calendar:nav.previousMonth')}
                onClick={() => setAnchor(view === 'week' ? addDays(anchor, -7) : addMonths(anchor, -1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" onClick={() => setAnchor(new Date())}>
                {t('calendar:nav.today')}
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label={view === 'week' ? t('calendar:nav.nextWeek') : t('calendar:nav.nextMonth')}
                onClick={() => setAnchor(view === 'week' ? addDays(anchor, 7) : addMonths(anchor, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="text-sm font-medium text-muted-foreground">
              {MONTH_LABELS[anchor.getMonth()]} {anchor.getFullYear()}
            </div>
          </div>

          {layers.length > 1 ? (
            <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <legend className="sr-only">{t('calendar:layers.shown')}</legend>
              {layers.map((layer) => (
                <label key={layer.userId} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={isLayerVisible(layer, shownLayers)}
                    disabled={layer.owner}
                    onChange={(e) => toggleLayer(layer.userId, e.target.checked)}
                  />
                  {layer.owner ? t('calendar:layers.mine') : layer.name}
                  {!layer.owner && layer.level === 'view' ? <span className="text-xs text-muted-foreground">{t('calendar:layers.viewOnly')}</span> : null}
                </label>
              ))}
            </fieldset>
          ) : null}

          {occurrences.isPending ? (
            <Skeleton className="h-96 w-full" />
          ) : occurrences.isError ? (
            <div className="rounded-lg border px-4 py-10 text-center text-sm">
              <p>{t('calendar:loadFailed')}</p>
              <Button variant="outline" className="mt-3" onClick={() => void occurrences.refetch()}>
                {t('common:actions.retry')}
              </Button>
            </div>
          ) : view === 'week' ? (
            <WeekView
              weekStart={weekStart}
              occurrences={visibleOccurrences}
              bookingWindows={bookingWindows}
              bookingBlocks={bookingBlocks.data ?? []}
              onBlockClick={(block) => deleteBlock.mutate(block)}
              onSlotClick={openCreate}
              onEventClick={openEdit}
              onEventDrop={(occ, start, end) => moveEvent.mutate({ occ, start, end })}
            />
          ) : (
            <MonthView
              monthDate={anchor}
              occurrences={visibleOccurrences}
              onDayClick={(day) => {
                setAnchor(day)
                setView('week')
              }}
              onEventClick={openEdit}
            />
          )}
        </div>
        {canBookings ? (
          <aside className="hidden lg:block" aria-label={t('calendar:booking.fromSite')}>
            {panel}
          </aside>
        ) : null}
      </div>

      <EventFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        event={editingEvent}
        prefill={prefill}
        meta={editingMeta}
        writableCalendars={writableCalendars}
      />
      {shareOpen && myId ? (
        <AccessShareDialog
          open
          onOpenChange={setShareOpen}
          title={t('calendar:share.title')}
          description={t('calendar:share.description')}
          ownerUserId={myId}
          shares={shares}
          isLoading={calendars.isPending}
          isPending={setShare.isPending || removeShare.isPending}
          onSet={(userId, level) => setShare.mutate({ userId, level })}
          onRemove={(userId) => removeShare.mutate(userId)}
        />
      ) : null}
      <BookingDetailDialog booking={bookingDetail} onOpenChange={(open) => !open && setBookingDetail(null)} />
      <Dialog open={panelOpenMobile} onOpenChange={setPanelOpenMobile}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{t('calendar:booking.short')}</DialogTitle>
          </DialogHeader>
          {panel}
        </DialogContent>
      </Dialog>
    </div>
  )
}
