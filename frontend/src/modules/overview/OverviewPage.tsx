import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlarmClockOff, Check, PhoneCall, SlidersHorizontal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { PlatformStatusBadge } from '@/shared/components/PlatformStatusBadge'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { StatePill, type StateTone } from '@/shared/components/ui/state-pill'
import { useLiveChatConversations } from '@/shared/hooks/use-chat'
import { useEmailUnreadCounts } from '@/shared/hooks/use-email-unread-counts'
import { useMe } from '@/shared/hooks/use-me'
import { eventLabel } from '@/shared/lib/event-label'
import { api } from '@/shared/lib/api'
import { sumByDirection } from '@/shared/lib/financial-utils'
import { cn, formatCount } from '@/shared/lib/utils'
import { formatNumber } from '@/shared/lib/format'
import type { AlertInstance, AlertSeverity, BookingSummary, CalendarOccurrence, EmailThread, MetricSummary, Note, OverviewConfig, Platform, PnlResponse } from '@/shared/lib/types'
import { extractEmailAddress } from '@/modules/email/identity'
import { conversationTitle } from '@/modules/messages/ConversationList'

// „Azi" (sprint Remake v2, DESIGN.md): un singur număr primar, apoi ce trebuie rezolvat și ce
// e în calendar. Propoziția de 2 secunde: cât am încasat luna asta, ce arde azi, ce am în calendar.

const TZ = 'Europe/Bucharest'

// Etichete pt. cheile standard din METRIC_KEYS.md + `mrr` (built-in, nu vine din platform_metrics).
// O cheie custom (`<platformă>.<metrică>`) fără etichetă arată partea de după punct.
const KPI_LABELS: Record<string, string> = {
  active_clients: 'Clienți activi',
  user_count: 'Utilizatori',
  mrr: 'MRR',
  revenue: 'Venituri (platformă)',
  collection_count: 'Tranzacții principale',
  stock_kg: 'Stoc curent',
}

function kpiLabel(key: string): string {
  return KPI_LABELS[key] ?? key.replace(/^[^.]+\./, '').replace(/_/g, ' ')
}

function lei(value: number): string {
  return `${new Intl.NumberFormat('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} lei`
}

const time = (iso: string) => new Intl.DateTimeFormat('ro-RO', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(iso))
const dayLabel = (iso: string) =>
  new Intl.DateTimeFormat('ro-RO', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: TZ }).format(new Date(iso))

function todayRange(): { from: string; to: string } {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { from: start.toISOString(), to: end.toISOString() }
}

const SEVERITY_TONE: Record<AlertSeverity, StateTone> = { critical: 'critical', warning: 'warning', info: 'neutral' }
const SEVERITY_LABEL: Record<AlertSeverity, string> = { critical: 'Critic', warning: 'Atenție', info: 'Info' }
const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 }

export function OverviewPage() {
  const { can } = useMe()
  const monthName = new Intl.DateTimeFormat('ro-RO', { month: 'long', timeZone: TZ }).format(new Date())
  const todayTitle = new Intl.DateTimeFormat('ro-RO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }).format(new Date())

  // Widget-urile se aleg pe funcționalități, nu pe `grid` cu locuri rezervate: un om cu o
  // singură funcționalitate primește o coloană, nu un widget pierdut pe o grilă de trei
  // (fișa „Azi, văzut de un coleg"). Numărul primar e al omului: pentru cine nu are
  // `financiar.view` e numărul de emailuri necitite, nu încasările firmei.
  const side: ReactNode[] = []
  if (can('calendar.view')) {
    side.push(
      <section key="calendar" aria-labelledby="calendar-heading">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 id="calendar-heading" className="text-sm font-medium text-muted-foreground">
            Calendar azi
          </h2>
          <Link to="/calendar" className="text-xs text-muted-foreground hover:text-foreground">
            Deschide calendarul
          </Link>
        </div>
        <TodayCalendar />
      </section>,
    )
  }
  if (can('platforme.view')) {
    side.push(
      <section key="platforms" aria-labelledby="platforms-heading">
        <h2 id="platforms-heading" className="mb-2 text-sm font-medium text-muted-foreground">
          Platforme
        </h2>
        <PlatformList />
      </section>,
    )
  }
  if (can('notite.view')) side.push(<PinnedNotes key="notes" />)

  const hasMoney = can('financiar.view')
  const hasAlerts = can('alerte.view')

  return (
    <div className="space-y-8" data-density={hasMoney ? undefined : 'comfortable'}>
      <div>
        <h1 className="text-2xl font-bold">Azi</h1>
        <p className="mt-1 text-sm text-muted-foreground first-letter:uppercase">{todayTitle}</p>
      </div>

      {hasMoney ? <PrimaryNumber monthName={monthName} /> : <UnreadPrimary />}

      {!hasMoney && can('email.view') ? (
        <section className="min-w-0" aria-labelledby="threads-heading">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 id="threads-heading" className="text-sm font-medium text-muted-foreground">
              Fire noi pe cutiile mele
            </h2>
            <Link to="/email" className="text-xs text-muted-foreground hover:text-foreground">
              Deschide emailul
            </Link>
          </div>
          <RecentThreads />
        </section>
      ) : null}

      {can('mesaje.view') ? (
        <section className="min-w-0" aria-labelledby="messages-heading">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 id="messages-heading" className="text-sm font-medium text-muted-foreground">
              Mesaje necitite
            </h2>
            <Link to="/messages" className="text-xs text-muted-foreground hover:text-foreground">
              Deschide mesajele
            </Link>
          </div>
          <UnreadMessages />
        </section>
      ) : null}

      <div className={side.length > 0 ? 'grid gap-8 lg:grid-cols-3' : ''}>
        {hasAlerts || hasMoney ? (
          <section className="min-w-0 lg:col-span-2" aria-labelledby="todo-heading">
            <h2 id="todo-heading" className="mb-2 text-sm font-medium text-muted-foreground">
              De rezolvat
            </h2>
            <TodoList />
          </section>
        ) : null}
        {side.length > 0 ? <div className="min-w-0 space-y-8">{side}</div> : null}
      </div>
    </div>
  )
}

/** Pentru omul fără `financiar.view`: numărul care e al lui, nu P&L-ul firmei. */
function UnreadPrimary() {
  const unread = useEmailUnreadCounts()
  if (unread.isPending) {
    return (
      <section aria-labelledby="unread-label">
        <p id="unread-label" className="text-sm text-muted-foreground">
          Emailuri necitite
        </p>
        <Skeleton className="mt-1 h-9 w-40" />
      </section>
    )
  }
  return (
    <section aria-labelledby="unread-label">
      <p id="unread-label" className="text-sm text-muted-foreground">
        Emailuri necitite
      </p>
      {unread.isError ? (
        <p className="mt-1 text-sm">
          Nu am putut număra emailurile.{' '}
          <button type="button" className="underline underline-offset-2" onClick={() => void unread.refetch()}>
            Încearcă din nou
          </button>
        </p>
      ) : (
        <p className="mt-1 font-mono text-3xl font-semibold tnum">{unread.data?.inbox ?? 0}</p>
      )}
    </section>
  )
}

/** Primele 5 fire de pe cutiile omului, cu cutia pe care a venit — la o cutie comună contează. */
function RecentThreads() {
  const threads = useQuery({
    queryKey: ['email', 'threads', 'recent'],
    queryFn: () => api.get<{ items: EmailThread[]; total: number }>('/api/email/threads?folder=inbox&limit=5'),
  })
  if (threads.isPending) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    )
  }
  if (threads.isError) {
    return (
      <p className="text-sm">
        Nu am putut încărca firele.{' '}
        <button type="button" className="underline underline-offset-2" onClick={() => void threads.refetch()}>
          Încearcă din nou
        </button>
      </p>
    )
  }
  const items = threads.data.items
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Niciun fir nou pe cutiile tale.</p>
  }
  return (
    <ul className="divide-y">
      {items.map((thread) => (
        <li key={thread.id}>
          <Link
            to={`/email?thread=${thread.id}`}
            className="flex min-w-0 items-center gap-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="w-24 shrink-0 truncate font-mono text-xs text-muted-foreground">
              {thread.toAddress ? extractEmailAddress(thread.toAddress) : '—'}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm">{thread.subject}</span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground tnum">{time(thread.lastMessageAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** Conversațiile cu mesaje necitite, cu numărul per conversație — un număr primar singur
 *  (totalul) ar ascunde de cine sunt, iar la un chat lista e scurtă oricum. */
function UnreadMessages() {
  const conversations = useLiveChatConversations()
  const { session } = useMe()
  const unread = (conversations.data ?? []).filter((c) => c.unreadCount > 0)

  if (conversations.isPending) {
    return (
      <div className="space-y-2" aria-busy="true">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    )
  }
  if (conversations.isError) {
    return (
      <p className="text-sm">
        Nu am putut încărca mesajele.{' '}
        <button type="button" className="underline underline-offset-2" onClick={() => void conversations.refetch()}>
          Încearcă din nou
        </button>
      </p>
    )
  }
  if (unread.length === 0) {
    return <p className="text-sm text-muted-foreground">Niciun mesaj necitit.</p>
  }
  return (
    <ul className="divide-y">
      {unread.map((conversation) => (
        <li key={conversation.id}>
          <Link
            to={`/messages/${conversation.id}`}
            className="flex items-center gap-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {conversation.kind === 'group' ? (conversation.name ?? 'Grup') : conversationTitle(conversation, session?.user.id ?? '')}
            </span>
            <span className="shrink-0 truncate text-xs text-muted-foreground">
              {conversation.lastMessage?.body ?? 'Fără mesaje'}
            </span>
            <span className="shrink-0 font-mono text-xs tnum">{conversation.unreadCount}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function PrimaryNumber({ monthName }: { monthName: string }) {
  const [editing, setEditing] = useState(false)
  const pnl = useQuery({
    queryKey: ['financials', 'pnl', 'mtd'],
    queryFn: () => api.get<PnlResponse>('/api/financials/pnl?period=mtd'),
  })
  const recurring = useQuery({
    queryKey: ['financials', 'recurring-revenue'],
    queryFn: () => api.get<{ mrrLei: number; mrrEur: number }>('/api/financials/recurring-revenue'),
  })
  const summary = useQuery({
    queryKey: ['metrics', 'summary', 'mtd'],
    queryFn: () => api.get<MetricSummary[]>('/api/metrics/summary?period=mtd'),
  })
  const overviewConfig = useQuery({
    queryKey: ['metrics', 'overview-config'],
    queryFn: () => api.get<OverviewConfig>('/api/metrics/overview-config'),
  })

  // Aceeași definiție ca „Venituri (încasate)" din Financiar: facturile emise luna asta și plătite.
  const collected = sumByDirection(pnl.data?.byMonth, 'out', ['paid'])
  const invoiced = sumByDirection(pnl.data?.byMonth, 'out')
  const byKey = new Map(summary.data?.map((m) => [m.metricKey, m]))
  const extra = (overviewConfig.data?.visibleKpis ?? []).filter((key) => key !== 'mrr')

  return (
    <section aria-labelledby="primary-label">
      <p id="primary-label" className="text-sm text-muted-foreground">
        Încasat în {monthName}
      </p>
      {pnl.isPending ? (
        <Skeleton className="mt-1 h-9 w-56" />
      ) : pnl.isError ? (
        <p className="mt-1 text-sm">
          Nu am putut calcula încasările.{' '}
          <button type="button" className="underline underline-offset-2" onClick={() => void pnl.refetch()}>
            Încearcă din nou
          </button>
        </p>
      ) : (
        <p className="mt-1 font-mono text-3xl font-semibold tnum">{lei(collected ?? 0)}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {invoiced !== null ? <span>Facturat {lei(invoiced)}</span> : null}
        {invoiced !== null && collected !== null ? <span>De încasat {lei(invoiced - collected)}</span> : null}
        {recurring.data ? <span>MRR {lei(recurring.data.mrrLei)}</span> : null}
        {extra.map((key) => {
          const metric = byKey.get(key)
          return metric ? (
            <span key={key}>
              {kpiLabel(key)} {formatNumber(metric.latest, metric.unit)}
            </span>
          ) : null
        })}
        <Button variant="ghost" size="icon-sm" title="Alege metricile de pe rândul ăsta" onClick={() => setEditing(true)}>
          <SlidersHorizontal />
          <span className="sr-only">Alege metricile</span>
        </Button>
      </div>
      <KpiVisibilityDialog
        open={editing}
        onOpenChange={setEditing}
        availableKeys={Array.from(new Set(summary.data?.map((m) => m.metricKey) ?? []))}
        visibleKpis={overviewConfig.data?.visibleKpis ?? []}
      />
    </section>
  )
}

interface TodoItem {
  id: string
  tone: StateTone
  label: string
  title: string
  meta?: string
  to: string
  actions?: ReactNode
}

function TodoList() {
  const queryClient = useQueryClient()
  const { can } = useMe()
  const alerts = useQuery({
    queryKey: ['alerts', 'list', 'active'],
    queryFn: () => api.get<AlertInstance[]>('/api/alerts?status=active'),
    enabled: can('alerte.view'),
  })
  const unread = useEmailUnreadCounts()
  // Programările de pe site sunt „doar Vanadium" (`calendar.programari`) — un coleg fără
  // ele nu are ce vedea aici, deci nici măcar nu întrebăm.
  const bookings = useQuery({
    queryKey: ['booking', 'bookings', 'upcoming'],
    queryFn: () => {
      const from = new Date()
      const to = new Date(from.getTime() + 30 * 86_400_000)
      return api.get<BookingSummary[]>(`/api/booking/bookings?from=${from.toISOString()}&to=${to.toISOString()}`)
    },
    enabled: can('calendar.programari'),
  })

  const invalidateAlerts = () => void queryClient.invalidateQueries({ queryKey: ['alerts'] })
  const ack = useMutation({
    mutationFn: (id: string) => api.patch(`/api/alerts/${id}/ack`, {}),
    onSuccess: invalidateAlerts,
    onError: () => toast.error('Alerta nu s-a confirmat. Încearcă din nou.'),
  })
  const snooze = useMutation({
    mutationFn: (id: string) => api.patch(`/api/alerts/${id}/snooze`, { days: 1 }),
    onSuccess: invalidateAlerts,
    onError: () => toast.error('Alerta nu s-a amânat. Încearcă din nou.'),
  })

  // Golul nu e un „No data": omul vede unde poate merge, pe paginile pe care le are.
  const emptyLinks = [
    can('email.view') && { to: '/email', label: 'Email' },
    can('calendar.view') && { to: '/calendar', label: 'Calendar' },
    can('clienti.view') && { to: '/pricing', label: 'Clienți' },
  ].filter((link): link is { to: string; label: string } => link !== false)

  const items: TodoItem[] = []
  for (const alert of [...(alerts.data ?? [])].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])) {
    items.push({
      id: `alert-${alert.id}`,
      tone: SEVERITY_TONE[alert.severity],
      label: SEVERITY_LABEL[alert.severity],
      title: alert.message,
      meta: alert.ruleName,
      to: '/alerts',
      actions: (
        <>
          <Button variant="ghost" size="icon-sm" title="Amână o zi" disabled={snooze.isPending} onClick={() => snooze.mutate(alert.id)}>
            <AlarmClockOff />
            <span className="sr-only">Amână o zi</span>
          </Button>
          <Button variant="ghost" size="icon-sm" title="Confirmă" disabled={ack.isPending} onClick={() => ack.mutate(alert.id)}>
            <Check />
            <span className="sr-only">Confirmă</span>
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
      label: 'Programare',
      title: `${dayLabel(booking.start)}, ${time(booking.start)} · ${[booking.name, booking.company].filter(Boolean).join(', ')}`,
      meta: booking.topic ?? undefined,
      to: '/calendar',
    })
  }
  const unreadTotal = unread.data?.inbox ?? 0
  if (unreadTotal > 0) {
    items.push({
      id: 'email-unread',
      tone: 'neutral',
      label: 'Email',
      title: `${formatCount(unreadTotal, 'email necitit', 'emailuri necitite')} în inbox`,
      to: '/email',
    })
  }

  const failedSources = [alerts.isError && 'alertele', unread.isError && 'emailul', bookings.isError && 'programările'].filter(Boolean) as string[]
  // `isPending` rămâne adevărat la un query oprit, deci se cer doar sursele care chiar
  // rulează — altfel un coleg fără alerte ar vedea scheletul la nesfârșit.
  const loading =
    unread.isPending || (can('alerte.view') && alerts.isPending) || (can('calendar.programari') && bookings.isPending)

  if (loading && items.length === 0) {
    return (
      <div className="space-y-1" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    )
  }

  return (
    <div>
      {items.length === 0 && failedSources.length === 0 ? (
        <div className="rounded-md bg-muted/50 px-3 py-6 text-center text-sm text-muted-foreground">
          <p>Nimic nou azi.</p>
          {emptyLinks.length > 0 ? (
            <p className="mt-1">
              {emptyLinks.map((link, i) => (
                <span key={link.to}>
                  {i > 0 ? ' · ' : null}
                  <Link to={link.to} className="underline underline-offset-2 hover:text-foreground">
                    {link.label}
                  </Link>
                </span>
              ))}
            </p>
          ) : null}
        </div>
      ) : (
        <ul className="divide-y">
          {items.map((item) => (
            <li key={item.id} className="group flex min-h-10 items-center gap-3 py-1.5">
              <StatePill tone={item.tone} className="w-20 justify-center">
                {item.label}
              </StatePill>
              <Link to={item.to} className="min-w-0 flex-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="block truncate text-sm">{item.title}</span>
                {item.meta ? <span className="block truncate text-xs text-muted-foreground">{item.meta}</span> : null}
              </Link>
              {item.actions ? (
                <div className="flex shrink-0 gap-1 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
                  {item.actions}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {failedSources.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Nu am putut încărca {failedSources.join(', ')}; restul listei e la zi.{' '}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={() => {
              if (alerts.isError) void alerts.refetch()
              if (unread.isError) void unread.refetch()
              if (bookings.isError) void bookings.refetch()
            }}
          >
            Încearcă din nou
          </button>
        </p>
      ) : null}
    </div>
  )
}

function TodayCalendar() {
  const range = todayRange()
  const myId = useMe().session?.user.id
  const events = useQuery({
    queryKey: ['calendar', 'events', range.from, range.to],
    queryFn: () => api.get<CalendarOccurrence[]>(`/api/calendar/events?from=${range.from}&to=${range.to}`),
  })
  if (events.isPending) return <Skeleton className="h-20 w-full" />
  if (events.isError) return <p className="text-sm text-muted-foreground">Calendarul nu s-a încărcat.</p>
  // Ziua omului: calendarul lui și evenimentele comune la care participă, nu și calendarele
  // partajate cu el (acelea se bifează în Calendar) și nici toate, la `calendar.administrare`.
  const mine = events.data.filter(
    (e) => e.access === 'owner' || e.ownerUserId === null || e.attendees.some((a) => a.id === myId),
  )
  const upcoming = mine.filter((e) => e.allDay || new Date(e.occurrenceEnd).getTime() > Date.now())
  if (upcoming.length === 0) return <p className="text-sm text-muted-foreground">Nimic în calendar până diseară.</p>
  return (
    <ul className="space-y-1">
      {upcoming.map((e) => (
        <li key={`${e.eventId}-${e.occurrenceStart}`} className="flex items-center gap-3 text-sm">
          <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground tnum">{e.allDay ? 'toată ziua' : time(e.occurrenceStart)}</span>
          <span className="min-w-0 flex-1 truncate">{eventLabel(e)}</span>
          {e.source === 'booking' ? <PhoneCall className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Programare de pe site" /> : null}
        </li>
      ))}
    </ul>
  )
}

function PlatformList() {
  const platforms = useQuery({ queryKey: ['platforms'], queryFn: () => api.get<Platform[]>('/api/platforms') })
  if (platforms.isPending) return <Skeleton className="h-10 w-full" />
  if (platforms.isError) return <p className="text-sm text-muted-foreground">Platformele nu s-au încărcat.</p>
  if (platforms.data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nicio platformă conectată. <Link to="/platforms" className="underline underline-offset-2">Adaugă una</Link>
      </p>
    )
  }
  return (
    <ul className="space-y-2">
      {platforms.data.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
          <div className="min-w-0">
            <div className="truncate">{p.name}</div>
            <div className="text-xs text-muted-foreground">
              {p.lastSyncAt ? `sincronizat ${new Intl.DateTimeFormat('ro-RO', { dateStyle: 'short', timeStyle: 'short', timeZone: TZ }).format(new Date(p.lastSyncAt))}` : 'nesincronizat încă'}
            </div>
          </div>
          <PlatformStatusBadge status={p.healthStatus} />
        </li>
      ))}
    </ul>
  )
}

function PinnedNotes() {
  const pinned = useQuery({ queryKey: ['notes', 'pinned'], queryFn: () => api.get<Note[]>('/api/notes?pinned=true') })
  if (!pinned.data?.length) return null
  return (
    <section aria-labelledby="notes-heading">
      <h2 id="notes-heading" className="mb-2 text-sm font-medium text-muted-foreground">
        Notițe fixate
      </h2>
      <ul className="space-y-1">
        {pinned.data.slice(0, 3).map((note) => (
          <li key={note.id}>
            <Link to="/notes" className={cn('block truncate rounded-sm text-sm hover:underline')}>
              {note.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function KpiVisibilityDialog({
  open,
  onOpenChange,
  availableKeys,
  visibleKpis,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  availableKeys: string[]
  visibleKpis: string[]
}) {
  const queryClient = useQueryClient()
  const update = useMutation({
    mutationFn: (next: string[]) => api.put<OverviewConfig>('/api/metrics/overview-config', { visibleKpis: next }),
    onSuccess: (data) => queryClient.setQueryData(['metrics', 'overview-config'], data),
    onError: () => toast.error('Alegerea nu s-a salvat. Încearcă din nou.'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-base">Metricile de sub încasări</DialogTitle>
        </DialogHeader>
        {availableKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nicio platformă nu a raportat metrici luna asta.</p>
        ) : (
          <div className="space-y-2">
            {availableKeys.map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={visibleKpis.includes(key)}
                  onChange={(e) => update.mutate(e.target.checked ? [...visibleKpis, key] : visibleKpis.filter((k) => k !== key))}
                />
                {kpiLabel(key)}
              </label>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
