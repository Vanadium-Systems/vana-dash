import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, ChevronLeft, ChevronRight, Plus, Search, Users, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AccessShareDialog } from '@/shared/components/AccessShareDialog'
import { useShareToMessages } from '@/shared/components/ShareToMessagesDialog'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Fab } from '@/shared/components/ui/fab'
import { Input } from '@/shared/components/ui/input'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { useConsumeParam } from '@/shared/hooks/use-consume-param'
import { useDebounced } from '@/shared/hooks/use-debounced'
import { useHotkeys } from '@/shared/hooks/use-hotkeys'
import { useMediaQuery } from '@/shared/hooks/use-media-query'
import { useMe } from '@/shared/hooks/use-me'
import { useSwipeNav } from '@/shared/hooks/use-swipe-nav'
import { api } from '@/shared/lib/api'
import { canEditOccurrence } from '@/shared/lib/event-label'
import { intlTag } from '@/shared/lib/format'
import { eventColors } from '@/shared/lib/tag-colors'
import { t } from '@/shared/lib/i18n'
import type {
  AccessLevel,
  BookingSummary,
  CalendarEvent,
  CalendarLayer,
  CalendarOccurrence,
  CalendarSearchHit,
  CalendarsPayload,
  SeriesScope,
} from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { AgendaView } from './AgendaView'
import { BookingDetailDialog, BookingPanel, useBookingBlocks, useBookings, useBookingSettings, useDeleteBlock } from './BookingPanel'
import { CalendarFilter } from './CalendarFilter'
import { CalendarPopover } from './CalendarPopover'
import { revertableToast, undoLast } from './calendar-undo'
import { addDays, addMonths, formatTime, isSameDay, startOfDay, startOfMonth, startOfWeek } from './date-utils'
import { EventFormDialog } from './EventFormDialog'
import { EventReadView, whenText } from './EventReadView'
import { MiniCalendar } from './MiniCalendar'
import { MonthView } from './MonthView'
import { QuickCreate } from './QuickCreate'
import { SeriesScopeDialog } from './SeriesScopeDialog'
import { occurrenceId, WeekView, type GridGhost, type TimeRange } from './WeekView'

type ViewMode = 'day' | 'week' | 'month' | 'agenda'
const VIEWS: ViewMode[] = ['day', 'week', 'month', 'agenda']

// Straturile bifate țin de om și de device, nu de URL: se aleg o dată și rămân.
const LAYERS_KEY = 'calendar-shown-layers'

function readShownLayers(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(LAYERS_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

const pad = (n: number) => String(n).padStart(2, '0')
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
}

function periodTitle(view: ViewMode, anchor: Date, weekStart: Date, phone: boolean): string {
  const tag = intlTag()
  // On a phone the week strip already names the weekday, and the year would cut the title.
  if (view === 'day' && phone) return new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'long' }).format(anchor)
  if (view === 'day') return new Intl.DateTimeFormat(tag, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(anchor)
  if (view === 'month') return new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric' }).format(anchor)
  if (view === 'agenda') return t('calendar:agenda.label')
  return new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'long', year: 'numeric' }).formatRange(weekStart, addDays(weekStart, 6))
}

/** The period, the view and the open event live in the URL (C25), so Back and a shared link work. */
function useCalendarUrl(phone: boolean) {
  const [params, setSearchParams] = useSearchParams()
  // One navigation per change: two setters in the same tick would each start from the same URL
  // and the second would drop the first's key.
  const patch = (values: Record<string, string>) =>
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        for (const [key, value] of Object.entries(values)) {
          if (value) next.set(key, value)
          else next.delete(key)
        }
        return next
      },
      { replace: true },
    )
  const viewParam = params.get('view') ?? ''
  const requested = VIEWS.includes(viewParam as ViewMode) ? (viewParam as ViewMode) : phone ? 'day' : 'week'
  // A phone has no room for seven columns: its week is a day with the week strip.
  const view: ViewMode = phone && requested === 'week' ? 'day' : requested
  const anchor = parseDateKey(params.get('date') ?? '') ?? startOfDay(new Date())
  return {
    view,
    anchor,
    eventId: params.get('event') || null,
    occKey: params.get('occ') || null,
    setView: (next: ViewMode) => patch({ view: next === (phone ? 'day' : 'week') ? '' : next }),
    setAnchor: (day: Date) => patch({ date: isSameDay(day, new Date()) ? '' : dateKey(day) }),
    showDay: (day: Date) => patch({ date: isSameDay(day, new Date()) ? '' : dateKey(day), view: phone ? '' : 'day' }),
    openEvent: (occ: CalendarOccurrence) => patch({ event: occ.eventId, occ: occ.occurrenceKey ?? '' }),
    openEventAt: (eventId: string, occKey: string | null, day: Date) =>
      patch({ event: eventId, occ: occKey ?? '', date: isSameDay(day, new Date()) ? '' : dateKey(day) }),
    closeEvent: () => patch({ event: '', occ: '' }),
  }
}

export function CalendarPage() {
  const { can, session } = useMe()
  const myId = session?.user.id
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const phone = useMediaQuery('(max-width: 639px)')
  const wide = useMediaQuery('(min-width: 1280px)')
  const url = useCalendarUrl(phone)
  const { view, anchor } = url
  const canWrite = can('calendar.editare')
  const canBookings = can('calendar.programari')
  const bookingSettings = useBookingSettings(canBookings)
  const bookingBlocks = useBookingBlocks(canBookings)
  const bookings = useBookings(canBookings)
  const deleteBlock = useDeleteBlock()
  const { canShare, share, dialog: shareToMessagesDialog } = useShareToMessages()

  const [formOpen, setFormOpen] = useState(false)
  const [formOccurrence, setFormOccurrence] = useState<CalendarOccurrence | null>(null)
  const [prefill, setPrefill] = useState<{ startAt: Date; endAt: Date; title?: string } | null>(null)
  const [bookingDetail, setBookingDetail] = useState<BookingSummary | null>(null)
  const [bookingsOpen, setBookingsOpen] = useState(false)
  const [focusBlockForm, setFocusBlockForm] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [shownLayers, setShownLayers] = useState<Set<string>>(readShownLayers)
  const [readAnchor, setReadAnchor] = useState<DOMRect | null>(null)
  const [draft, setDraft] = useState<{ range: TimeRange; anchor: DOMRect } | null>(null)
  const [pendingMove, setPendingMove] = useState<{ occ: CalendarOccurrence; start: Date; end: Date } | null>(null)
  const [scopeRequest, setScopeRequest] = useState<{ action: 'move' | 'edit' | 'delete'; resolve: (scope: SeriesScope | null) => void } | null>(null)
  const [moreDay, setMoreDay] = useState<{ day: Date; items: CalendarOccurrence[]; anchor: DOMRect } | null>(null)
  const [agendaMonths, setAgendaMonths] = useState(1)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const debouncedTerm = useDebounced(searchTerm.trim(), 250)

  const requestScope = (action: 'move' | 'edit' | 'delete') =>
    new Promise<SeriesScope | null>((resolve) => setScopeRequest({ action, resolve }))

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

  function changeShownLayers(next: Set<string>) {
    setShownLayers(next)
    try {
      localStorage.setItem(LAYERS_KEY, JSON.stringify([...next]))
    } catch {
      // Fără storage (fereastră privată) bifa ține doar până la reîncărcare.
    }
  }

  // Ctrl K → „Blochează interval pentru programări": deschide panoul cu formularul în focus.
  useConsumeParam('block', () => {
    setFocusBlockForm(true)
    setBookingsOpen(true)
  })

  const weekStart = startOfWeek(anchor)
  const today = startOfDay(new Date())
  const [rangeStart, rangeEnd] =
    view === 'day'
      ? [startOfDay(anchor), addDays(startOfDay(anchor), 1)]
      : view === 'week'
        ? [weekStart, addDays(weekStart, 7)]
        : view === 'month'
          ? [startOfWeek(startOfMonth(anchor)), addDays(startOfWeek(startOfMonth(anchor)), 42)]
          : [today, addMonths(today, agendaMonths)]
  // On a phone the day view keeps the whole week loaded, so the week strip moves without a wait.
  const [fetchStart, fetchEnd] = phone && view === 'day' ? [weekStart, addDays(weekStart, 7)] : [rangeStart, rangeEnd]

  const occurrences = useQuery({
    queryKey: ['calendar', 'events', fetchStart.toISOString(), fetchEnd.toISOString()],
    queryFn: () => api.get<CalendarOccurrence[]>(`/api/calendar/events?from=${fetchStart.toISOString()}&to=${fetchEnd.toISOString()}`),
    // The grid stays while the next period loads; only its events change (C26).
    placeholderData: keepPreviousData,
  })

  const visibleOccurrences = (occurrences.data ?? []).filter((occ) => {
    if (!occ.ownerUserId) return true // cheltuieli recurente: ale firmei, fără calendar
    if (occ.ownerUserId === myId) return true
    // Un eveniment comun la care omul e participant stă în calendarul lui, oricare ar fi creatorul.
    if (myId && occ.attendees.some((a) => a.id === myId)) return true
    return shownLayers.has(occ.ownerUserId)
  })

  // ── The open event (URL) ──
  const openOcc = useMemo(() => {
    if (!url.eventId) return null
    return (occurrences.data ?? []).find((o) => o.eventId === url.eventId && (url.occKey ? o.occurrenceKey === url.occKey : true)) ?? null
  }, [occurrences.data, url.eventId, url.occKey])
  const openedFromLink = useRef(false)
  useEffect(() => {
    // Opened from a link: the event is not in the loaded period (or is gone) → say so and close.
    if (!url.eventId || occurrences.isPlaceholderData || !occurrences.data || openOcc) return
    if (openedFromLink.current) return
    openedFromLink.current = true
    toast.error(t('calendar:read.notFound'))
    url.closeEvent()
  }, [url.eventId, occurrences.data, occurrences.isPlaceholderData, openOcc])

  const showEvent = (occ: CalendarOccurrence, anchorEl?: HTMLElement) => {
    if (occ.kind === 'expense') {
      // Ocurență virtuală din recurring_expenses — nu există în calendar_events, needitabilă
      // din formularul de eveniment. Editarea reală se face din Accounting.
      toast.info(t('calendar:toasts.recurringExpenseHint'), { description: occ.title })
      navigate('/accounting?tab=primite')
      return
    }
    if (occ.source === 'booking') {
      void openBooking(occ)
      return
    }
    openedFromLink.current = true
    setReadAnchor(anchorEl?.getBoundingClientRect() ?? null)
    url.openEvent(occ)
  }

  async function openBooking(occ: CalendarOccurrence) {
    // useBookings aduce doar de acum încolo; o programare deja trecută (sau de mai devreme azi)
    // se cere separat pe intervalul ei, altfel clickul cădea în formularul de eveniment, fără email.
    const cached = bookings.data?.find((b) => b.calendarEventId === occ.eventId)
    const booking =
      cached ??
      (await api.get<BookingSummary[]>(`/api/booking/bookings?from=${occ.occurrenceStart}&to=${occ.occurrenceEnd}`).catch(() => [])).find(
        (b) => b.calendarEventId === occ.eventId,
      )
    if (booking) setBookingDetail(booking)
  }

  const closeRead = () => {
    setReadAnchor(null)
    url.closeEvent()
  }

  // ── Writes, each with its undo ──
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['calendar'] })
  const occQuery = (occ: CalendarOccurrence, scope: SeriesScope) =>
    `?scope=${scope}&occurrence=${encodeURIComponent(occ.occurrenceKey ?? occ.occurrenceStart)}`

  const moveEvent = useMutation({
    mutationFn: async ({ occ, start, end, scope }: { occ: CalendarOccurrence; start: Date; end: Date; scope: SeriesScope | null }) => {
      const path = `/api/calendar/events/${occ.eventId}`
      if (!scope) return api.write<CalendarEvent>('PATCH', path, { startAt: start.toISOString(), endAt: end.toISOString() })
      if (scope === 'all') {
        // The series row moves by as much as the dragged occurrence did; a resize changes its length.
        const shift = start.getTime() - new Date(occ.occurrenceStart).getTime()
        const seriesStart = new Date(new Date(occ.seriesStart).getTime() + shift)
        return api.write<CalendarEvent>('PATCH', path + occQuery(occ, scope), {
          startAt: seriesStart.toISOString(),
          endAt: new Date(seriesStart.getTime() + (end.getTime() - start.getTime())).toISOString(),
        })
      }
      return api.write<CalendarEvent>('PATCH', path + occQuery(occ, scope), { startAt: start.toISOString(), endAt: end.toISOString() })
    },
    onSuccess: ({ revertToken }, { occ, start }) => {
      invalidate()
      const when = new Intl.DateTimeFormat(intlTag(), { weekday: 'long' }).format(start)
      revertableToast(t('calendar:toasts.movedTo', { title: occ.title, when: `${when}, ${formatTime(start)}` }), revertToken, queryClient)
    },
    // The block goes back where it was; the error stays until read.
    onError: (err) => toast.error(err.message, { duration: Infinity }),
    onSettled: () => setPendingMove(null),
  })

  async function changeEvent(occ: CalendarOccurrence, start: Date, end: Date) {
    setPendingMove({ occ, start, end })
    let scope: SeriesScope | null = null
    if (occ.isRecurring) {
      scope = await requestScope('move')
      if (!scope) return setPendingMove(null)
    }
    moveEvent.mutate({ occ, start, end, scope })
  }

  const deleteEvent = useMutation({
    mutationFn: ({ occ, scope }: { occ: CalendarOccurrence; scope: SeriesScope | null }) =>
      api.write<CalendarEvent>('DELETE', `/api/calendar/events/${occ.eventId}${scope ? occQuery(occ, scope) : ''}`),
    onSuccess: ({ revertToken }, { occ }) => {
      invalidate()
      revertableToast(t('calendar:toasts.deletedNamed', { title: occ.title }), revertToken, queryClient)
    },
    onError: (err) => toast.error(err.message),
  })

  async function removeEvent(occ: CalendarOccurrence) {
    let scope: SeriesScope | null = null
    if (occ.isRecurring) {
      scope = await requestScope('delete')
      if (!scope) return
    }
    closeRead()
    deleteEvent.mutate({ occ, scope })
  }

  const duplicateEvent = useMutation({
    mutationFn: (occ: CalendarOccurrence) =>
      api.write<CalendarEvent>('POST', `/api/calendar/events/${occ.eventId}/duplicate`, occ.occurrenceKey ? { occurrence: occ.occurrenceKey } : {}),
    onSuccess: ({ revertToken }, occ) => {
      invalidate()
      revertableToast(t('calendar:toasts.duplicatedNamed', { title: occ.title }), revertToken, queryClient)
    },
    onError: (err) => toast.error(err.message),
  })

  const quickCreate = useMutation({
    mutationFn: ({ title, range, calendarOwnerUserId }: { title: string; range: TimeRange; calendarOwnerUserId: string | null }) =>
      api.write<CalendarEvent>('POST', '/api/calendar/events', {
        title,
        startAt: range.start.toISOString(),
        endAt: range.end.toISOString(),
        calendarOwnerUserId: calendarOwnerUserId ?? undefined,
      }),
    onSuccess: ({ revertToken }, { title }) => {
      invalidate()
      setDraft(null)
      revertableToast(t('calendar:toasts.eventCreatedNamed', { title }), revertToken, queryClient)
    },
    onError: (err) => toast.error(err.message),
  })

  // ── Creating ──
  const openForm = (occurrence: CalendarOccurrence | null, nextPrefill: typeof prefill = null) => {
    setFormOccurrence(occurrence)
    setPrefill(nextPrefill)
    setFormOpen(true)
  }

  const createAt = (day: Date) => {
    if (!canWrite) return
    const start = new Date(day)
    const now = new Date()
    if (isSameDay(day, now)) start.setHours(now.getHours() + 1, 0, 0, 0)
    else start.setHours(9, 0, 0, 0)
    openForm(null, { startAt: start, endAt: new Date(start.getTime() + 3_600_000) })
  }

  useConsumeParam('new', () => createAt(new Date()))

  const onRangeDrawn = (range: TimeRange, rect: DOMRect) => {
    if (!canWrite) return
    // A phone has no room for a popover beside the grid: the full form, as before.
    if (phone) return openForm(null, { startAt: range.start, endAt: range.end })
    setDraft({ range, anchor: rect })
  }

  // ── Navigation ──
  const stepPeriod = (direction: 1 | -1) => {
    if (view === 'day') url.setAnchor(addDays(anchor, direction))
    else if (view === 'week') url.setAnchor(addDays(anchor, 7 * direction))
    else if (view === 'month') url.setAnchor(addMonths(anchor, direction))
  }
  const swipeNav = useSwipeNav({ onPrev: () => stepPeriod(-1), onNext: () => stepPeriod(1) })

  // ── Search in the calendar (C24) ──
  const search = useQuery({
    queryKey: ['calendar', 'search', debouncedTerm],
    queryFn: () => api.get<CalendarSearchHit[]>(`/api/calendar/events/search?q=${encodeURIComponent(debouncedTerm)}`),
    enabled: debouncedTerm.length >= 2,
  })
  const closeSearch = () => {
    setSearchOpen(false)
    setSearchTerm('')
  }
  const goToHit = (hit: CalendarSearchHit) => {
    closeSearch()
    // The event opens once its period is loaded.
    openedFromLink.current = false
    setReadAnchor(null)
    url.openEventAt(hit.eventId, hit.occurrenceKey, startOfDay(new Date(hit.occurrenceStart)))
  }

  // ── Shortcuts (C23) ──
  useHotkeys([
    { keys: 'c', label: t('calendar:shortcuts.create'), onKey: () => createAt(anchor) },
    { keys: 't', label: t('calendar:shortcuts.today'), onKey: () => url.setAnchor(new Date()) },
    { keys: 'n', label: t('calendar:shortcuts.next'), onKey: () => stepPeriod(1) },
    { keys: 'j', label: t('calendar:shortcuts.next'), onKey: () => stepPeriod(1) },
    { keys: 'p', label: t('calendar:shortcuts.previous'), onKey: () => stepPeriod(-1) },
    { keys: 'k', label: t('calendar:shortcuts.previous'), onKey: () => stepPeriod(-1) },
    { keys: 'd', label: t('calendar:view.day'), onKey: () => url.setView('day') },
    { keys: 'w', label: t('calendar:view.week'), onKey: () => url.setView('week') },
    { keys: 'm', label: t('calendar:view.month'), onKey: () => url.setView('month') },
    { keys: 'a', label: t('calendar:view.agenda'), onKey: () => url.setView('agenda') },
    { keys: '/', label: t('calendar:search.label'), onKey: (e) => (e.preventDefault(), setSearchOpen(true), setTimeout(() => searchRef.current?.focus())) },
    { keys: 'e', label: t('common:actions.edit'), onKey: () => openOcc && canEditOccurrence(openOcc) && (closeRead(), openForm(openOcc)) },
    { keys: 'delete', label: t('common:actions.delete'), onKey: () => openOcc && canEditOccurrence(openOcc) && void removeEvent(openOcc) },
    { keys: 'mod+z', label: t('common:undo.action'), onKey: (e) => undoLast(queryClient) && e.preventDefault() },
  ])

  // Booking hours spread over the days shown, on the browser's clock like the rest of the grid.
  const gridDays = view === 'day' ? [startOfDay(anchor)] : Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const bookingWindows: TimeRange[] =
    canBookings && bookingSettings.data?.enabled
      ? gridDays.flatMap((day) => {
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

  const ghost: GridGhost | null = pendingMove
    ? { start: pendingMove.start, end: pendingMove.end, label: pendingMove.occ.title, color: pendingMove.occ.color, ownerUserId: pendingMove.occ.ownerUserId }
    : draft
      ? { start: draft.range.start, end: draft.range.end, label: t('calendar:quick.untitled'), ownerUserId: myId ?? null }
      : null

  const shares = calendars.data?.given
  const setShare = useMutation({
    mutationFn: ({ userId, level }: { userId: string; level: AccessLevel }) => api.post('/api/calendar/shares', { ownerUserId: myId, userId, level }),
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

  const panel = <BookingPanel focusBlockForm={focusBlockForm} onBookingClick={setBookingDetail} />
  const firstLoad = occurrences.isPending && !occurrences.data
  const phoneMonthDay = phone && view === 'month' ? anchor : null

  const viewSwitch = (
    <div className="flex rounded-md border" role="group" aria-label={t('calendar:view.label')}>
      {VIEWS.filter((v) => !(phone && v === 'week')).map((v) => (
        <Button key={v} variant={view === v ? 'default' : 'ghost'} size={phone ? 'sm' : 'md'} aria-pressed={view === v} onClick={() => url.setView(v)}>
          {t(`calendar:view.${v}`)}
        </Button>
      ))}
    </div>
  )

  const searchBox = (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        ref={searchRef}
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && closeSearch()}
        placeholder={t('calendar:search.placeholder')}
        aria-label={t('calendar:search.label')}
        className="w-full pl-8 sm:w-56"
      />
      {debouncedTerm.length >= 2 ? (
        <div className="glass absolute right-0 z-30 mt-1 max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border p-1 shadow-md" role="listbox">
          {search.isPending ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">{t('common:states.loading')}</p>
          ) : (search.data ?? []).length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">{t('calendar:search.empty', { term: debouncedTerm })}</p>
          ) : (
            search.data!.map((hit) => (
              <button
                key={`${hit.eventId}-${hit.occurrenceStart}`}
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full flex-col rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                onClick={() => goToHit(hit)}
              >
                <span className="truncate font-medium">{hit.title}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat(intlTag(), { dateStyle: 'medium', ...(hit.allDay ? {} : { timeStyle: 'short' }) }).format(new Date(hit.occurrenceStart))}
                  {hit.location ? ` · ${hit.location}` : ''}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )

  const phoneMonthList = phoneMonthDay
    ? visibleOccurrences
        .filter((o) => isSameDay(new Date(o.occurrenceStart), phoneMonthDay) || (o.allDay && new Date(o.occurrenceStart) <= phoneMonthDay && new Date(o.occurrenceEnd) > phoneMonthDay))
        .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.occurrenceStart.localeCompare(b.occurrenceStart))
    : []

  return (
    <div className="space-y-4">
      {/* Header (C20, C29): the period is the title; the actions wrap under it before it gets cut. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <div className="flex min-w-0 items-center gap-1">
          {view !== 'agenda' ? (
            <>
              <Button variant="ghost" size="icon" aria-label={t('calendar:nav.previous')} onClick={() => stepPeriod(-1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label={t('calendar:nav.next')} onClick={() => stepPeriod(1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          ) : null}
          <h1 className="min-w-0 truncate px-1 text-xl font-semibold first-letter:uppercase">{periodTitle(view, anchor, weekStart, phone)}</h1>
          <Button variant="outline" size={phone ? 'sm' : 'md'} className="ml-1" onClick={() => url.setAnchor(new Date())}>
            {t('calendar:nav.today')}
          </Button>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {phone ? (
            <Button variant="ghost" size="icon" aria-label={t('calendar:search.label')} onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}>
              {searchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}
            </Button>
          ) : (
            searchBox
          )}
          {!phone ? viewSwitch : null}
          <CalendarFilter layers={layers} shown={shownLayers} onChange={changeShownLayers} />
          {myId && !phone ? (
            <Button variant="outline" onClick={() => setShareOpen(true)}>
              <Users className="h-4 w-4" /> {t('common:actions.share')}
            </Button>
          ) : null}
          {canWrite && !phone ? (
            <Button onClick={() => createAt(anchor)}>
              <Plus className="h-4 w-4" /> {t('calendar:event.newTitle')}
            </Button>
          ) : null}
          {canBookings ? (
            <Button variant="outline" size={phone ? 'sm' : 'md'} onClick={() => setBookingsOpen(true)}>
              <CalendarClock className="h-4 w-4" /> {t('calendar:booking.short')}
            </Button>
          ) : null}
        </div>
      </div>
      {phone ? (
        <div className="space-y-2">
          {searchOpen ? searchBox : null}
          <div className="flex items-center justify-between gap-2">
            {viewSwitch}
            {myId ? (
              <Button variant="ghost" size="sm" onClick={() => setShareOpen(true)}>
                <Users className="h-4 w-4" /> {t('common:actions.share')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          'grid gap-6',
          // The bookings panel (mostly settings) opens from its button: the grid gets the width.
          wide && 'grid-cols-[232px_minmax(0,1fr)]',
        )}
      >
        {wide ? (
          <aside aria-label={t('calendar:mini.label')}>
            <MiniCalendar month={anchor} selected={anchor} onSelect={(day) => url.setAnchor(day)} onMonthChange={(month) => url.setAnchor(month)} />
          </aside>
        ) : null}
        <div className="min-w-0 space-y-3" style={swipeNav.style} {...swipeNav.handlers}>
          {phone && view === 'day' ? (
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((day) => {
                const selected = isSameDay(day, anchor)
                const isTodayDay = isSameDay(day, new Date())
                return (
                  <button
                    key={day.toISOString()}
                    type="button"
                    aria-pressed={selected}
                    className={cn(
                      'flex flex-col items-center rounded-md py-1 text-xs',
                      selected ? 'bg-primary text-primary-foreground' : isTodayDay ? 'bg-primary/10 text-primary' : 'text-muted-foreground',
                    )}
                    onClick={() => url.setAnchor(day)}
                  >
                    <span>{new Intl.DateTimeFormat(intlTag(), { weekday: 'short' }).format(day)}</span>
                    <span className="font-semibold">{day.getDate()}</span>
                  </button>
                )
              })}
            </div>
          ) : null}

          {firstLoad ? (
            <Skeleton className="h-[calc(100dvh-16rem)] w-full rounded-lg" />
          ) : occurrences.isError && !occurrences.data ? (
            <div className="rounded-lg border px-4 py-10 text-center text-sm">
              <p>{t('calendar:loadFailed')}</p>
              <Button variant="outline" className="mt-3" onClick={() => void occurrences.refetch()}>
                {t('common:actions.retry')}
              </Button>
            </div>
          ) : view === 'day' || view === 'week' ? (
            <WeekView
              days={gridDays}
              occurrences={visibleOccurrences}
              bookingWindows={bookingWindows}
              bookingBlocks={bookingBlocks.data ?? []}
              onBlockClick={(block) => deleteBlock.mutate(block)}
              canCreate={canWrite}
              ghost={ghost}
              hiddenKey={pendingMove ? occurrenceId(pendingMove.occ) : null}
              onRangeDrawn={onRangeDrawn}
              onEventClick={showEvent}
              onEventChange={(occ, start, end) => void changeEvent(occ, start, end)}
              onDayHeaderClick={view === 'week' ? url.showDay : undefined}
            />
          ) : view === 'month' ? (
            <>
              <MonthView
                monthDate={anchor}
                occurrences={visibleOccurrences}
                selectedDay={phone ? anchor : undefined}
                onDayClick={(day) => (phone ? url.setAnchor(day) : url.showDay(day))}
                onEventClick={(occ) => showEvent(occ)}
                onMoreClick={(day, items, el) => setMoreDay({ day, items, anchor: el.getBoundingClientRect() })}
              />
              {phoneMonthDay ? (
                <section aria-label={whenTitle(phoneMonthDay)} className="space-y-1">
                  <h2 className="px-1 text-sm font-medium first-letter:uppercase">{whenTitle(phoneMonthDay)}</h2>
                  {phoneMonthList.length === 0 ? (
                    <p className="px-1 py-2 text-sm text-muted-foreground">{t('calendar:agenda.empty')}</p>
                  ) : (
                    phoneMonthList.map((occ) => <DayListRow key={occurrenceId(occ)} occ={occ} onClick={() => showEvent(occ)} />)
                  )}
                </section>
              ) : null}
            </>
          ) : (
            <AgendaView from={today} occurrences={visibleOccurrences} onEventClick={(occ) => showEvent(occ)} onLoadMore={() => setAgendaMonths((m) => m + 1)} hasMore={agendaMonths < 12} />
          )}
        </div>
      </div>

      {canWrite && phone ? (
        <Fab
          icon={<Plus className="h-6 w-6" />}
          label={t('calendar:fab.addOn', { day: new Intl.DateTimeFormat(intlTag(), { weekday: 'long' }).format(anchor) })}
          onClick={() => createAt(anchor)}
        />
      ) : null}

      {/* Read first, act from the bar (C12): a popover beside the event, a sheet on a phone. */}
      <CalendarPopover
        anchor={openOcc ? (readAnchor ?? new DOMRect(window.innerWidth / 2 - 180, 96, 0, 0)) : null}
        title={openOcc?.title ?? ''}
        onClose={closeRead}
      >
        {openOcc ? (
          <EventReadView
            occ={openOcc}
            canEdit={canEditOccurrence(openOcc) && canWrite}
            canDuplicate={canWrite}
            canShare={canShare}
            onEdit={() => {
              closeRead()
              openForm(openOcc)
            }}
            onDelete={() => void removeEvent(openOcc)}
            onDuplicate={() => {
              closeRead()
              duplicateEvent.mutate(openOcc)
            }}
            onShare={() => {
              closeRead()
              share({ type: 'calendar_event', id: openOcc.eventId, title: openOcc.title })
            }}
            onCopyLink={() => {
              const params = new URLSearchParams({ date: dateKey(new Date(openOcc.occurrenceStart)), event: openOcc.eventId })
              if (openOcc.occurrenceKey) params.set('occ', openOcc.occurrenceKey)
              void navigator.clipboard.writeText(`${window.location.origin}/calendar?${params.toString()}`).then(
                () => toast(t('common:states.copied')),
                () => toast.error(t('calendar:read.copyFailed')),
              )
            }}
          />
        ) : null}
      </CalendarPopover>

      <CalendarPopover anchor={draft?.anchor ?? null} title={t('calendar:event.newTitle')} onClose={() => setDraft(null)}>
        {draft ? (
          <QuickCreate
            start={draft.range.start}
            end={draft.range.end}
            calendars={writableCalendars}
            pending={quickCreate.isPending}
            onSave={(title, calendarOwnerUserId) => quickCreate.mutate({ title, range: draft.range, calendarOwnerUserId })}
            onMore={(title) => {
              const range = draft.range
              setDraft(null)
              openForm(null, { startAt: range.start, endAt: range.end, title })
            }}
          />
        ) : null}
      </CalendarPopover>

      <CalendarPopover anchor={moreDay?.anchor ?? null} title={moreDay ? whenTitle(moreDay.day) : ''} onClose={() => setMoreDay(null)}>
        {moreDay ? (
          <div className="space-y-1">
            <h2 className="text-sm font-medium first-letter:uppercase">{whenTitle(moreDay.day)}</h2>
            {moreDay.items.map((occ) => (
              <DayListRow
                key={occurrenceId(occ)}
                occ={occ}
                onClick={() => {
                  setMoreDay(null)
                  showEvent(occ)
                }}
              />
            ))}
          </div>
        ) : null}
      </CalendarPopover>

      <EventFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        occurrence={formOccurrence}
        prefill={prefill}
        writableCalendars={writableCalendars}
        requestScope={requestScope}
        onShowEvent={(start) => {
          if (start < rangeStart || start >= rangeEnd) url.setAnchor(startOfDay(start))
        }}
      />
      <SeriesScopeDialog
        request={scopeRequest}
        onAnswer={(scope) => {
          scopeRequest?.resolve(scope)
          setScopeRequest(null)
        }}
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
      {shareToMessagesDialog}
      <BookingDetailDialog booking={bookingDetail} onOpenChange={(open) => !open && setBookingDetail(null)} />
      <Dialog open={bookingsOpen} onOpenChange={setBookingsOpen}>
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

function whenTitle(day: Date): string {
  return new Intl.DateTimeFormat(intlTag(), { weekday: 'long', day: 'numeric', month: 'long' }).format(day)
}

function DayListRow({ occ, onClick }: { occ: CalendarOccurrence; onClick: () => void }) {
  return (
    <button type="button" className="flex min-h-10 w-full items-center gap-3 rounded-md px-2 text-left text-sm hover:bg-accent" onClick={onClick}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: eventColors(occ.color, occ.ownerUserId).background }} aria-hidden="true" />
      <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{whenText(occ).split(' · ').at(-1)}</span>
      <span className="min-w-0 flex-1 truncate">{occ.title}</span>
    </button>
  )
}
