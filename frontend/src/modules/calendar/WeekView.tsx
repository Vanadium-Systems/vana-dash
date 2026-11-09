import { PhoneCall, Repeat } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { haptic } from '@/shared/lib/haptics'
import type { BookingBlock, CalendarOccurrence } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { formatTime, isToday, WEEKDAY_LABELS } from './date-utils'
import { allDayOn, drawnRange, dragTarget, layoutDay, placedStyle, resizeTarget, type DayGrid } from './week-layout'
import { canEditOccurrence, eventLabel } from '@/shared/lib/event-label'
import { eventColors } from '@/shared/lib/tag-colors'
import { t } from '@/shared/lib/i18n'

const HOUR_HEIGHT = 48 // px
const GRID: DayGrid = { startHour: 0, endHour: 24, hourHeight: HOUR_HEIGHT }
const HOURS = Array.from({ length: GRID.endHour - GRID.startHour }, (_, i) => GRID.startHour + i)
/** Mouse: a drag starts after this many px, so a click stays a click. */
const DRAG_THRESHOLD = 4
/** Touch: a press this long starts a drag; moving first means the finger wants to scroll. */
const LONG_PRESS_MS = 400
const TOUCH_SLOP = 8

export interface TimeRange {
  start: Date
  end: Date
}

/** A block drawn on the grid that is not an event yet (a range being created, a move awaiting its scope). */
export interface GridGhost {
  start: Date
  end: Date
  label: string
  color?: string | null
  ownerUserId?: string | null
}

interface TimeGridProps {
  days: Date[]
  occurrences: CalendarOccurrence[]
  // Straturile programărilor (DESIGN.md, Calendar): se deosebesc prin formă, nu prin culoare.
  bookingWindows?: TimeRange[]
  bookingBlocks?: BookingBlock[]
  onBlockClick?: (block: BookingBlock) => void
  canCreate: boolean
  ghost?: GridGhost | null
  /** The occurrence hidden under `ghost` while its move waits for an answer. */
  hiddenKey?: string | null
  onRangeDrawn: (range: TimeRange, anchor: DOMRect) => void
  onEventClick: (occurrence: CalendarOccurrence, anchor: HTMLElement) => void
  onEventChange: (occurrence: CalendarOccurrence, start: Date, end: Date) => void
  onDayHeaderClick?: (day: Date) => void
}

export const occurrenceId = (occ: CalendarOccurrence) => `${occ.eventId}|${occ.occurrenceKey ?? occ.occurrenceStart}`

type Gesture =
  | { kind: 'move' | 'resize'; occ: CalendarOccurrence; x0: number; y0: number; dayIndex0: number; pointerId: number; active: boolean }
  | { kind: 'draw'; dayIndex: number; y0: number; pointerId: number; active: boolean; x0: number }

function rangeStyle(start: Date, end: Date, day: Date): { top: number; height: number } | null {
  const dayStart = new Date(day)
  dayStart.setHours(GRID.startHour, 0, 0, 0)
  const dayEnd = new Date(day)
  dayEnd.setHours(GRID.endHour, 0, 0, 0)
  const from = Math.max(start.getTime(), dayStart.getTime())
  const to = Math.min(end.getTime(), dayEnd.getTime())
  if (to <= from) return null
  return { top: ((from - dayStart.getTime()) / 3_600_000) * HOUR_HEIGHT, height: ((to - from) / 3_600_000) * HOUR_HEIGHT }
}

function BookingLayers({ day, windows, blocks, onBlockClick }: { day: Date; windows: TimeRange[]; blocks: BookingBlock[]; onBlockClick?: (block: BookingBlock) => void }) {
  return (
    <>
      {windows.map((w) => {
        const style = rangeStyle(w.start, w.end, day)
        return style ? (
          <div
            key={w.start.toISOString()}
            className="pointer-events-none absolute inset-x-0.5 overflow-hidden rounded-md border border-dashed border-foreground/30"
            style={style}
          >
            {/* Cut with an ellipsis in a narrow column instead of running past the frame. */}
            <span className="absolute left-1 right-1 top-0.5 truncate text-right text-xs text-muted-foreground">{t('calendar:booking.short')}</span>
          </div>
        ) : null
      })}
      {blocks.map((b) => {
        const style = rangeStyle(new Date(b.startAt), new Date(b.endAt), day)
        return style ? (
          <button
            key={b.id}
            type="button"
            title={b.reason ? t('calendar:week.blockedWithReason', { reason: b.reason }) : t('calendar:week.blockedForBookings')}
            className="absolute inset-x-0.5 z-[1] overflow-hidden rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-left text-xs text-muted-foreground [background-image:repeating-linear-gradient(135deg,transparent_0_6px,hsl(var(--border))_6px_7px)]"
            style={style}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onBlockClick?.(b)
            }}
          >
            {b.reason ? t('calendar:week.blockedWithReason', { reason: b.reason }) : t('calendar:week.blocked')}
          </button>
        ) : null
      })}
    </>
  )
}

function EventTitle({ occ }: { occ: CalendarOccurrence }) {
  return (
    <div className="flex items-center gap-1 truncate font-medium">
      {occ.source === 'booking' ? <PhoneCall className="h-3 w-3 shrink-0" aria-label={t('calendar:booking.siteBooking')} /> : null}
      {occ.isRecurring ? <Repeat className="h-3 w-3 shrink-0 opacity-80" aria-label={t('calendar:read.repeats')} /> : null}
      <span className="truncate">{eventLabel(occ)}</span>
    </div>
  )
}

/** Actualizat la fiecare minut — suficient de "live" pt. o linie de "acum", fără cost real. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

function chipStyle(occ: CalendarOccurrence) {
  const colors = eventColors(occ.color, occ.ownerUserId)
  return { backgroundColor: colors.background, color: colors.color }
}

const isMovable = (occ: CalendarOccurrence) =>
  // O programare de pe site nu se mută prin tragere: ora e promisă vizitatorului prin email.
  canEditOccurrence(occ) && occ.source !== 'booking' && !occ.allDay

export function WeekView({
  days,
  occurrences,
  bookingWindows = [],
  bookingBlocks = [],
  onBlockClick,
  canCreate,
  ghost,
  hiddenKey,
  onRangeDrawn,
  onEventClick,
  onEventChange,
  onDayHeaderClick,
}: TimeGridProps) {
  const now = useNow()
  const scrollRef = useRef<HTMLDivElement>(null)
  const columnRefs = useRef<(HTMLDivElement | null)[]>([])
  const gestureRef = useRef<Gesture | null>(null)
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Set after a drag, so the click the browser fires on release does not open the event.
  const suppressClickRef = useRef(false)
  const [live, setLive] = useState<{ occ: CalendarOccurrence | null; start: Date; end: Date } | null>(null)

  const nowOffset = now.getHours() + now.getMinutes() / 60 - GRID.startHour
  const todayIndex = days.findIndex((d) => isToday(d))
  const firstDayKey = days[0]?.toISOString()
  const hasOccurrences = occurrences.length > 0

  // Opening position (C30): "now" a third from the top when today is shown, otherwise 07:00 or
  // the first earlier event of the period.
  useLayoutEffect(() => {
    const box = scrollRef.current
    if (!box) return
    if (todayIndex >= 0) {
      box.scrollTop = Math.max(0, nowOffset * HOUR_HEIGHT - box.clientHeight / 3)
      return
    }
    const firstHour = occurrences.filter((o) => !o.allDay).reduce((hour, o) => Math.min(hour, new Date(o.occurrenceStart).getHours()), 7)
    box.scrollTop = firstHour * HOUR_HEIGHT
    // Only when the period changes or its events first arrive: not on every minute tick.
  }, [firstDayKey, hasOccurrences])

  function columnIndexAt(clientX: number): number {
    let best = 0
    columnRefs.current.forEach((col, i) => {
      if (!col) return
      const rect = col.getBoundingClientRect()
      if (clientX >= rect.left) best = i
    })
    return best
  }

  function offsetInColumn(dayIndex: number, clientY: number): number {
    const rect = columnRefs.current[dayIndex]?.getBoundingClientRect()
    return rect ? clientY - rect.top : 0
  }

  function clearLongPress() {
    if (longPressRef.current) clearTimeout(longPressRef.current)
    longPressRef.current = null
  }

  // A touch drag must not scroll the grid: while active, touchmove is cancelled (non-passive).
  useEffect(() => {
    const stopScroll = (e: TouchEvent) => {
      if (gestureRef.current?.active) e.preventDefault()
    }
    document.addEventListener('touchmove', stopScroll, { passive: false })
    return () => document.removeEventListener('touchmove', stopScroll)
  }, [])

  function activate(gesture: Gesture, touch: boolean) {
    gesture.active = true
    if (touch) void haptic('tap')
  }

  function begin(e: ReactPointerEvent, gesture: Gesture) {
    if (e.button !== 0) return
    gestureRef.current = gesture
    const touch = e.pointerType === 'touch'
    if (touch) {
      longPressRef.current = setTimeout(() => {
        const g = gestureRef.current
        if (g && !g.active) {
          activate(g, true)
          update(g.x0, g.kind === 'draw' ? g.y0 + (columnRefs.current[g.dayIndex]?.getBoundingClientRect().top ?? 0) : g.y0)
        }
      }, LONG_PRESS_MS)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  function update(clientX: number, clientY: number) {
    const g = gestureRef.current
    if (!g?.active) return
    if (g.kind === 'draw') {
      const day = days[g.dayIndex]
      if (!day) return
      const range = drawnRange(day, g.y0, offsetInColumn(g.dayIndex, clientY), GRID)
      setLive({ occ: null, ...range })
      return
    }
    const start = new Date(g.occ.occurrenceStart)
    const end = new Date(g.occ.occurrenceEnd)
    if (g.kind === 'resize') {
      setLive({ occ: g.occ, start, end: resizeTarget(start, end, clientY - g.y0, GRID) })
      return
    }
    const dayDelta = columnIndexAt(clientX) - g.dayIndex0
    setLive({ occ: g.occ, ...dragTarget(start, end, dayDelta, clientY - g.y0, GRID) })
  }

  function onMove(e: PointerEvent) {
    const g = gestureRef.current
    if (!g || e.pointerId !== g.pointerId) return
    const distance = Math.hypot(e.clientX - g.x0, e.clientY - (g.kind === 'draw' ? e.clientY : g.y0))
    if (!g.active) {
      if (e.pointerType === 'touch') {
        // Moving before the long press fires: the finger is scrolling, not dragging.
        if (Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > TOUCH_SLOP && g.kind !== 'draw') cancel()
        if (g.kind === 'draw' && Math.abs(e.clientX - g.x0) + Math.abs(offsetInColumn(g.dayIndex, e.clientY) - g.y0) > TOUCH_SLOP) cancel()
        return
      }
      const moved = g.kind === 'draw' ? Math.abs(offsetInColumn(g.dayIndex, e.clientY) - g.y0) : distance
      if (moved < DRAG_THRESHOLD) return
      activate(g, false)
    }
    update(e.clientX, e.clientY)
  }

  function finish() {
    clearLongPress()
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    gestureRef.current = null
  }

  function cancel() {
    finish()
    setLive(null)
  }

  function onCancel() {
    cancel()
  }

  function onUp(e: PointerEvent) {
    const g = gestureRef.current
    if (!g || e.pointerId !== g.pointerId) return
    const wasActive = g.active
    finish()
    // Everything is recomputed from the release point: these listeners were attached in the
    // render where the gesture began, so `live` here would be that render's (stale) value.
    if (g.kind === 'draw') {
      const day = days[g.dayIndex]
      if (!day) return setLive(null)
      // A tap or click without drag still creates: the hour slot under it.
      const range = drawnRange(day, g.y0, wasActive ? offsetInColumn(g.dayIndex, e.clientY) : g.y0, GRID)
      const col = columnRefs.current[g.dayIndex]?.getBoundingClientRect()
      const top = (col?.top ?? 0) + ((range.start.getHours() * 60 + range.start.getMinutes()) / 60) * HOUR_HEIGHT
      setLive(null)
      onRangeDrawn(range, new DOMRect(col?.left ?? e.clientX, top, col?.width ?? 0, ((range.end.getTime() - range.start.getTime()) / 3_600_000) * HOUR_HEIGHT))
      return
    }
    setLive(null)
    if (!wasActive) return
    suppressClickRef.current = true
    setTimeout(() => (suppressClickRef.current = false), 0)
    const start = new Date(g.occ.occurrenceStart)
    const end = new Date(g.occ.occurrenceEnd)
    const target =
      g.kind === 'resize'
        ? { start, end: resizeTarget(start, end, e.clientY - g.y0, GRID) }
        : dragTarget(start, end, columnIndexAt(e.clientX) - g.dayIndex0, e.clientY - g.y0, GRID)
    if (target.start.getTime() === start.getTime() && target.end.getTime() === end.getTime()) return
    onEventChange(g.occ, target.start, target.end)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && gestureRef.current) cancel()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      finish()
    }
  }, [])

  const draggingId = live?.occ ? occurrenceId(live.occ) : null
  const cols = `48px repeat(${days.length},minmax(0,1fr))`

  function renderBlock(start: Date, end: Date, day: Date, label: string, color: string | null | undefined, ownerUserId: string | null | undefined, key: string) {
    const colors = eventColors(color ?? null, ownerUserId ?? null)
    const style = rangeStyle(start, end, day)
    if (!style) return null
    return (
      <div
        key={key}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-1.5 z-[3] overflow-hidden rounded-md px-1.5 py-1 text-xs shadow-lg ring-2 ring-background"
        style={{ top: style.top, height: Math.max(style.height - 2, 14), backgroundColor: colors.background, color: colors.color }}
      >
        <div className="truncate font-medium">{label}</div>
        <div className="truncate opacity-90">
          {formatTime(start)}–{formatTime(end)}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border">
      <div className="grid border-b" style={{ gridTemplateColumns: cols }}>
        <div />
        {days.map((day) => {
          const today = isToday(day)
          return (
            <button
              key={day.toISOString()}
              type="button"
              disabled={!onDayHeaderClick}
              className={cn('min-w-0 border-l px-2 py-2 text-center text-sm font-medium', today && 'bg-primary/5', onDayHeaderClick && 'hover:bg-accent/50')}
              onClick={() => onDayHeaderClick?.(day)}
            >
              <span className={cn(today ? 'text-primary' : 'text-muted-foreground')}>{WEEKDAY_LABELS[day.getDay() === 0 ? 6 : day.getDay() - 1]}</span>{' '}
              <span className={cn('inline-flex h-6 w-6 items-center justify-center rounded-full', today && 'bg-primary font-semibold text-primary-foreground')}>
                {day.getDate()}
              </span>
            </button>
          )
        })}
      </div>

      <div className="grid border-b" style={{ gridTemplateColumns: cols }}>
        <div className="px-2 py-1 text-right text-xs text-muted-foreground">{t('calendar:week.allDay')}</div>
        {days.map((day) => (
          <div key={day.toISOString()} className={cn('min-w-0 space-y-1 border-l px-1 py-1', isToday(day) && 'bg-primary/5')}>
            {allDayOn(occurrences, day).map((occ) => (
              <button
                key={occurrenceId(occ)}
                type="button"
                className="block w-full truncate rounded px-1.5 py-0.5 text-left text-xs"
                style={chipStyle(occ)}
                onClick={(e) => onEventClick(occ, e.currentTarget)}
              >
                {eventLabel(occ)}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div ref={scrollRef} className="max-h-[calc(100dvh-16rem)] overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: cols }}>
          <div>
            {HOURS.map((h) => (
              <div key={h} className="border-t px-2 text-right text-xs tabular-nums text-muted-foreground" style={{ height: HOUR_HEIGHT }}>
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>
          {days.map((day, dayIndex) => {
            const today = isToday(day)
            return (
              <div
                key={day.toISOString()}
                ref={(el) => (columnRefs.current[dayIndex] = el)}
                className={cn('relative min-w-0 select-none border-l', today && 'bg-primary/5', canCreate && 'cursor-cell')}
                style={{ height: HOUR_HEIGHT * HOURS.length }}
                onPointerDown={(e) => {
                  if (!canCreate) return
                  begin(e, { kind: 'draw', dayIndex, y0: offsetInColumn(dayIndex, e.clientY), x0: e.clientX, pointerId: e.pointerId, active: false })
                }}
              >
                {HOURS.map((h) => (
                  <div key={h} className="border-t" style={{ height: HOUR_HEIGHT }} />
                ))}
                <BookingLayers day={day} windows={bookingWindows} blocks={bookingBlocks} onBlockClick={onBlockClick} />
                {/* A free strip on both sides of the chips, so a full column still takes a click (C22),
                    the same on the left and the right. */}
                <div className="pointer-events-none absolute inset-y-0 inset-x-1.5">
                  {layoutDay(occurrences, day, GRID).map((placed) => {
                    const { occ } = placed
                    const id = occurrenceId(occ)
                    const start = new Date(occ.occurrenceStart)
                    const end = new Date(occ.occurrenceEnd)
                    const movable = isMovable(occ)
                    const dimmed = id === draggingId || id === hiddenKey
                    return (
                      <button
                        key={id}
                        type="button"
                        className={cn(
                          'pointer-events-auto absolute z-[2] touch-pan-y overflow-hidden rounded-md px-1.5 py-1 text-left text-xs ring-1 ring-background',
                          movable && 'cursor-grab active:cursor-grabbing',
                          dimmed && 'opacity-30',
                        )}
                        style={{ ...placedStyle(placed), ...chipStyle(occ) }}
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          if (!movable) return
                          begin(e, { kind: 'move', occ, x0: e.clientX, y0: e.clientY, dayIndex0: dayIndex, pointerId: e.pointerId, active: false })
                        }}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (suppressClickRef.current) return
                          onEventClick(occ, e.currentTarget)
                        }}
                      >
                        <EventTitle occ={occ} />
                        <div className="truncate opacity-90">
                          {formatTime(start)}–{formatTime(end)}
                        </div>
                        {movable ? (
                          <span
                            aria-hidden="true"
                            className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                            onPointerDown={(e) => {
                              e.stopPropagation()
                              begin(e, { kind: 'resize', occ, x0: e.clientX, y0: e.clientY, dayIndex0: dayIndex, pointerId: e.pointerId, active: false })
                            }}
                          />
                        ) : null}
                      </button>
                    )
                  })}
                </div>
                {live ? renderBlock(live.start, live.end, day, live.occ ? eventLabel(live.occ) : t('calendar:quick.untitled'), live.occ?.color, live.occ?.ownerUserId, `live-${dayIndex}`) : null}
                {ghost ? renderBlock(ghost.start, ghost.end, day, ghost.label, ghost.color, ghost.ownerUserId, `ghost-${dayIndex}`) : null}
                {today && nowOffset >= 0 && nowOffset <= HOURS.length ? (
                  <div className="pointer-events-none absolute left-0 right-0 z-10 border-t-2 border-destructive-text" style={{ top: nowOffset * HOUR_HEIGHT }}>
                    <div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-destructive" />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
