import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlarmClockOff, Check, PhoneCall } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { extractEmailAddress } from '@/modules/email/identity'
import { conversationTitle } from '@/modules/messages/ConversationList'
import { PlatformStatusBadge } from '@/shared/components/PlatformStatusBadge'
import { Button } from '@/shared/components/ui/button'
import { StatePill, type StateTone } from '@/shared/components/ui/state-pill'
import { useLiveChatConversations } from '@/shared/hooks/use-chat'
import { useEmailUnreadCounts } from '@/shared/hooks/use-email-unread-counts'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { eventLabel } from '@/shared/lib/event-label'
import { companyTimeZone, formatDate, intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { AlertInstance, AlertSeverity, BookingSummary, CalendarOccurrence, EmailThread, Note, Platform } from '@/shared/lib/types'
import { WidgetFrame, widgetState } from './WidgetFrame'
import type { WidgetProps } from './types'

export const time = (iso: string) => new Intl.DateTimeFormat(intlTag(), { hour: '2-digit', minute: '2-digit', timeZone: companyTimeZone() }).format(new Date(iso))
const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat(intlTag(), { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: companyTimeZone() }).format(new Date(iso))

const SEVERITY_TONE: Record<AlertSeverity, StateTone> = { critical: 'critical', warning: 'warning', info: 'neutral' }
const SEVERITY_LABEL: Record<AlertSeverity, () => string> = {
  critical: () => t('common:states.critical'),
  warning: () => t('common:states.warning'),
  info: () => t('common:states.info'),
}
const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 }

function todayRange(): { from: string; to: string } {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { from: start.toISOString(), to: end.toISOString() }
}

export interface TodoItem {
  id: string
  tone: StateTone
  label: string
  title: string
  meta?: string
  to: string
  actions?: ReactNode
}

/** Active alerts first by severity, then new bookings; shared by the widget, the window and "Următorul pas". */
export function useTodoItems() {
  const { can } = useMe()
  const queryClient = useQueryClient()
  const alerts = useQuery({
    queryKey: ['alerts', 'list', 'active'],
    queryFn: () => api.get<AlertInstance[]>('/api/alerts?status=active'),
    enabled: can('alerte.view'),
    staleTime: 30_000,
  })
  // Bookings from the site are the owner company's (`calendar.programari`); without it nothing is asked.
  const bookings = useQuery({
    queryKey: ['booking', 'bookings', 'upcoming'],
    queryFn: () => {
      const from = new Date()
      const to = new Date(from.getTime() + 30 * 86_400_000)
      return api.get<BookingSummary[]>(`/api/booking/bookings?from=${from.toISOString()}&to=${to.toISOString()}`)
    },
    enabled: can('calendar.programari'),
    staleTime: 30_000,
  })
  const invalidateAlerts = () => void queryClient.invalidateQueries({ queryKey: ['alerts'] })
  const ack = useMutation({
    mutationFn: (id: string) => api.patch(`/api/alerts/${id}/ack`, {}),
    onSuccess: invalidateAlerts,
    onError: () => toast.error(t('overview:todo.ackFailed')),
  })
  const snooze = useMutation({
    mutationFn: (id: string) => api.patch(`/api/alerts/${id}/snooze`, { days: 1 }),
    onSuccess: invalidateAlerts,
    onError: () => toast.error(t('overview:todo.snoozeFailed')),
  })

  const items: TodoItem[] = []
  for (const alert of [...(alerts.data ?? [])].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])) {
    items.push({
      id: `alert-${alert.id}`,
      tone: SEVERITY_TONE[alert.severity],
      label: SEVERITY_LABEL[alert.severity](),
      title: alert.message,
      meta: alert.ruleName,
      to: '/alerts',
      actions: (
        <>
          <Button variant="ghost" size="icon-sm" title={t('overview:todo.snoozeOneDay')} disabled={snooze.isPending} onClick={() => snooze.mutate(alert.id)}>
            <AlarmClockOff />
            <span className="sr-only">{t('overview:todo.snoozeOneDay')}</span>
          </Button>
          <Button variant="ghost" size="icon-sm" title={t('common:actions.confirm')} disabled={ack.isPending} onClick={() => ack.mutate(alert.id)}>
            <Check />
            <span className="sr-only">{t('common:actions.confirm')}</span>
          </Button>
        </>
      ),
    })
  }
  const newBookings = (bookings.data ?? []).filter((b) => b.status === 'confirmed' && Date.now() - new Date(b.createdAt).getTime() < 3 * 86_400_000)
  for (const booking of newBookings) {
    items.push({
      id: `booking-${booking.id}`,
      tone: 'neutral',
      label: t('overview:todo.booking'),
      title: `${dayLabel(booking.start)}, ${time(booking.start)} · ${[booking.name, booking.company].filter(Boolean).join(', ')}`,
      meta: booking.topic ?? undefined,
      to: '/calendar',
    })
  }
  const pending = (can('alerte.view') && alerts.isPending) || (can('calendar.programari') && bookings.isPending)
  const isError = alerts.isError || bookings.isError
  return {
    items,
    critical: (alerts.data ?? []).filter((a) => a.severity === 'critical').length,
    warnings: (alerts.data ?? []).filter((a) => a.severity === 'warning').length,
    query: { isPending: pending, isError, dataUpdatedAt: alerts.dataUpdatedAt },
    refetch: () => {
      void alerts.refetch()
      void bookings.refetch()
    },
  }
}

export function ToResolveWidget({ size, preview }: WidgetProps) {
  const todo = useTodoItems()
  const shown = todo.items.slice(0, size === 'l' ? 8 : 2)
  return (
    <WidgetFrame
      title={t('overview:todo.title')}
      module={t('common:nav.alerts')}
      action={{ to: '/alerts', label: t('overview:widgets.openAlerts') }}
      updatedAt={todo.query.dataUpdatedAt}
      state={widgetState(todo.query, todo.items.length === 0)}
      emptyText={t('overview:todo.nothingNew')}
      onRetry={todo.refetch}
      preview={preview}
    >
      <ul className="divide-y">
        {shown.map((item) => (
          <li key={item.id} className="group flex min-h-control-md items-center gap-3 py-1">
            <StatePill tone={item.tone} className="w-20 justify-center">
              {item.label}
            </StatePill>
            <Link to={item.to} className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="block truncate text-sm">{item.title}</span>
              {item.meta && size === 'l' ? <span className="block truncate text-xs text-muted-foreground">{item.meta}</span> : null}
            </Link>
            {item.actions && !preview ? (
              <div className="flex shrink-0 gap-1 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
                {item.actions}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {todo.items.length > shown.length ? (
        <p className="mt-1 text-xs text-muted-foreground">{t('overview:widgets.more', { count: todo.items.length - shown.length })}</p>
      ) : null}
    </WidgetFrame>
  )
}

export function TodayWidget({ size, preview }: WidgetProps) {
  const range = todayRange()
  const myId = useMe().session?.user.id
  const events = useQuery({
    queryKey: ['calendar', 'events', range.from, range.to],
    queryFn: () => api.get<CalendarOccurrence[]>(`/api/calendar/events?from=${range.from}&to=${range.to}`),
    staleTime: 30_000,
  })
  // The person's own day: their calendar and the shared events they attend, not the calendars
  // shared with them (those are ticked in Calendar).
  const mine = (events.data ?? []).filter((e) => e.access === 'owner' || e.ownerUserId === null || e.attendees.some((a) => a.id === myId))
  const upcoming = mine.filter((e) => e.allDay || new Date(e.occurrenceEnd).getTime() > Date.now())
  const shown = upcoming.slice(0, size === 'l' ? 9 : 4)
  return (
    <WidgetFrame
      title={t('overview:calendar.title')}
      module={t('common:nav.calendar')}
      action={{ to: '/calendar', label: t('overview:calendar.open') }}
      updatedAt={events.dataUpdatedAt}
      state={widgetState(events, upcoming.length === 0)}
      emptyText={t('overview:calendar.nothingUntilEvening')}
      onRetry={() => void events.refetch()}
      preview={preview}
    >
      <ul className="space-y-1.5">
        {shown.map((e) => (
          <li key={`${e.eventId}-${e.occurrenceStart}`} className="flex items-center gap-3 text-sm">
            <span className="w-12 shrink-0 text-xs text-text-3 tnum">{e.allDay ? t('overview:calendar.allDay') : time(e.occurrenceStart)}</span>
            <span className="min-w-0 flex-1 truncate">{eventLabel(e)}</span>
            {e.source === 'booking' ? <PhoneCall className="size-3.5 shrink-0 text-muted-foreground" aria-label={t('overview:calendar.bookingFromSite')} /> : null}
          </li>
        ))}
      </ul>
    </WidgetFrame>
  )
}

export function UnreadMessagesWidget({ size, preview }: WidgetProps) {
  const conversations = useLiveChatConversations()
  const { session } = useMe()
  const unread = (conversations.data ?? []).filter((c) => c.unreadCount > 0)
  const total = unread.reduce((sum, c) => sum + c.unreadCount, 0)
  return (
    <WidgetFrame
      title={t('overview:messages.unread')}
      module={t('common:nav.messages')}
      action={{ to: '/messages', label: t('overview:messages.open') }}
      updatedAt={conversations.dataUpdatedAt}
      state={widgetState(conversations, unread.length === 0)}
      emptyText={t('overview:messages.noneUnread')}
      onRetry={() => void conversations.refetch()}
      preview={preview}
    >
      {size === 's' ? (
        <div>
          <p className="text-2xl font-semibold tnum">{total}</p>
          <p className="truncate text-xs text-muted-foreground">
            {unread
              .slice(0, 2)
              .map((c) => (c.kind === 'group' ? (c.name ?? t('overview:messages.group')) : conversationTitle(c, session?.user.id ?? '')))
              .join(', ')}
          </p>
        </div>
      ) : (
        <ul className="divide-y">
          {unread.slice(0, 4).map((conversation) => (
            <li key={conversation.id}>
              <Link to={`/messages/${conversation.id}`} className="flex items-center gap-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {conversation.kind === 'group' ? (conversation.name ?? t('overview:messages.group')) : conversationTitle(conversation, session?.user.id ?? '')}
                </span>
                <span className="shrink-0 text-xs tnum">{conversation.unreadCount}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetFrame>
  )
}

export function EmailWidget({ size, preview }: WidgetProps) {
  const unread = useEmailUnreadCounts()
  const threads = useQuery({
    queryKey: ['email', 'threads', 'recent'],
    queryFn: () => api.get<{ items: EmailThread[]; total: number }>('/api/email/threads?folder=inbox&limit=8'),
    staleTime: 30_000,
  })
  const items = threads.data?.items ?? []
  return (
    <WidgetFrame
      title={t('overview:email.newThreads')}
      module={t('common:nav.email')}
      action={{ to: '/email?compose=1', label: t('overview:widgets.writeEmail') }}
      updatedAt={threads.dataUpdatedAt}
      state={widgetState(threads, items.length === 0)}
      emptyText={t('overview:email.noNewThreads')}
      onRetry={() => void threads.refetch()}
      preview={preview}
    >
      {unread.data?.inbox ? <p className="mb-1 text-xs text-muted-foreground">{t('overview:todo.unreadInInbox', { count: unread.data.inbox })}</p> : null}
      <ul className="divide-y">
        {items.slice(0, size === 'l' ? 8 : 2).map((thread) => (
          <li key={thread.id}>
            <Link to={`/email?thread=${thread.id}`} className="flex min-w-0 items-center gap-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="min-w-0 flex-1 truncate text-sm">{thread.subject}</span>
              {size === 'l' ? (
                <span className="hidden w-28 shrink-0 truncate text-xs text-text-3 sm:block">{thread.toAddress ? extractEmailAddress(thread.toAddress) : ''}</span>
              ) : null}
              <span className="shrink-0 text-xs text-text-3 tnum">{time(thread.lastMessageAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </WidgetFrame>
  )
}

export function PlatformStatusWidget({ size, preview }: WidgetProps) {
  const platforms = useQuery({ queryKey: ['platforms'], queryFn: () => api.get<Platform[]>('/api/platforms'), staleTime: 30_000 })
  const list = platforms.data ?? []
  const down = list.filter((p) => p.healthStatus !== 'healthy')
  return (
    <WidgetFrame
      title={t('overview:widgets.platforms')}
      module={t('common:nav.platforms')}
      action={{ to: '/platforms', label: t('overview:widgets.openPlatforms') }}
      updatedAt={platforms.dataUpdatedAt}
      state={widgetState(platforms, list.length === 0)}
      emptyText={t('overview:platforms.none')}
      onRetry={() => void platforms.refetch()}
      preview={preview}
    >
      {size === 's' ? (
        <p className="text-sm">{down.length === 0 ? t('overview:widgets.allPlatformsOk', { count: list.length }) : t('overview:widgets.platformsDown', { count: down.length })}</p>
      ) : (
        <ul className="space-y-2">
          {list.slice(0, 3).map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="truncate">{p.name}</div>
                <div className="truncate text-xs text-text-3">
                  {p.lastSyncAt ? t('overview:platforms.syncedAt', { when: formatDate(p.lastSyncAt, { dateStyle: 'short', timeStyle: 'short' }) }) : t('overview:platforms.notSyncedYet')}
                </div>
              </div>
              <PlatformStatusBadge status={p.healthStatus} />
            </li>
          ))}
        </ul>
      )}
    </WidgetFrame>
  )
}

export function PinnedNoteWidget({ size, preview }: WidgetProps) {
  const pinned = useQuery({ queryKey: ['notes', 'pinned'], queryFn: () => api.get<Note[]>('/api/notes?pinned=true'), staleTime: 30_000 })
  const notes = pinned.data ?? []
  return (
    <WidgetFrame
      title={t('overview:notes.pinned')}
      module={t('common:nav.notes')}
      action={{ to: '/notes', label: t('overview:widgets.openNotes') }}
      updatedAt={pinned.dataUpdatedAt}
      state={widgetState(pinned, notes.length === 0)}
      emptyText={t('overview:widgets.noPinned')}
      onRetry={() => void pinned.refetch()}
      preview={preview}
    >
      <ul className="space-y-1">
        {notes.slice(0, size === 'l' ? 8 : 3).map((note) => (
          <li key={note.id}>
            <Link to="/notes" className="block truncate rounded-sm text-sm hover:underline">
              {note.title}
            </Link>
          </li>
        ))}
      </ul>
    </WidgetFrame>
  )
}
