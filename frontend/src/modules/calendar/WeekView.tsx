import { PhoneCall } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { chartColor } from '@/shared/lib/chart-colors'
import type { BookingBlock, CalendarOccurrence } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { addDays, formatTime, isToday, WEEKDAY_LABELS } from './date-utils'
import { allDayOn, layoutDay, placedStyle } from './week-layout'
import { canEditOccurrence, eventLabel } from '@/shared/lib/event-label'
import { t } from '@/shared/lib/i18n'

const VIEW_START_HOUR = 0
const VIEW_END_HOUR = 24
const HOUR_HEIGHT = 48 // px
const DAY_GRID = { startHour: VIEW_START_HOUR, endHour: VIEW_END_HOUR, hourHeight: HOUR_HEIGHT }

export interface TimeRange {
  start: Date
  end: Date
}

interface WeekViewProps {
  weekStart: Date
  occurrences: CalendarOccurrence[]
  // Straturile programărilor (DESIGN.md, Calendar): se deosebesc prin formă, nu prin culoare.
  bookingWindows?: TimeRange[]
  bookingBlocks?: BookingBlock[]
  onBlockClick?: (block: BookingBlock) => void
  onSlotClick: (start: Date, end: Date) => void
  onEventClick: (occurrence: CalendarOccurrence) => void
  onEventDrop: (occurrence: CalendarOccurrence, newStart: Date, newEnd: Date) => void
}

function rangeStyle(start: Date, end: Date, day: Date): { top: number; height: number } | null {
  const dayStart = new Date(day)
  dayStart.setHours(VIEW_START_HOUR, 0, 0, 0)
  const dayEnd = new Date(day)
  dayEnd.setHours(VIEW_END_HOUR, 0, 0, 0)
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
            className="pointer-events-none absolute inset-x-0.5 rounded-md border border-dashed border-foreground/30"
            style={style}
          >
            <span className="absolute right-1 top-0.5 text-xs text-muted-foreground">{t('calendar:booking.short')}</span>
          </div>
        ) : null
      })}
      {blocks.map((b) => {
        const style = rangeStyle(new Date(b.startAt), new Date(b.endAt), day)
        return style ? (
          <button
            key={b.id}
            type="button"
            title={b.reason ? `Blocat: ${b.reason}` : t('calendar:week.blockedForBookings')}
            className="absolute inset-x-0.5 z-[1] overflow-hidden rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-left text-xs text-muted-foreground [background-image:repeating-linear-gradient(135deg,transparent_0_6px,hsl(var(--border))_6px_7px)]"
            style={style}
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
      <span className="truncate">{eventLabel(occ)}</span>
    </div>
  )
}

const DRAG_SNAP_HOUR = 0.25 // 15 min

function snappedDropTime(e: DragEvent<HTMLElement>, day: Date): Date {
  const rect = e.currentTarget.getBoundingClientRect()
  const rawHour = VIEW_START_HOUR + (e.clientY - rect.top) / HOUR_HEIGHT
  const snapped = Math.min(Math.max(Math.round(rawHour / DRAG_SNAP_HOUR) * DRAG_SNAP_HOUR, VIEW_START_HOUR), VIEW_END_HOUR)
  const start = new Date(day)
  start.setHours(Math.floor(snapped), Math.round((snapped % 1) * 60), 0, 0)
  return start
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

export function WeekView({ weekStart, occurrences, bookingWindows = [], bookingBlocks = [], onBlockClick, onSlotClick, onEventClick, onEventDrop }: WeekViewProps) {
  const now = useNow()
  const [draggedOcc, setDraggedOcc] = useState<CalendarOccurrence | null>(null)
  const [dragOverDay, setDragOverDay] = useState<string | null>(null)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const hours = Array.from({ length: VIEW_END_HOUR - VIEW_START_HOUR }, (_, i) => VIEW_START_HOUR + i)
  const nowOffset = now.getHours() + now.getMinutes() / 60 - VIEW_START_HOUR
  const showNowLine = nowOffset >= 0 && nowOffset <= hours.length

  // Mobil (360-414px): grila întreagă de 7 zile (min-w-[560px]) forța scroll orizontal pe TOATĂ
  // săptămâna, nu doar pe o coloană — inutilizabil pt. citit un program. View "zi" implicit sub
  // `sm`, cu pastile de navigare între zilele săptămânii — desktop rămâne neschimbat (grila
  // completă, `hidden sm:block` mai jos).
  const todayIndex = days.findIndex((d) => isToday(d))
  const [mobileDayIndex, setMobileDayIndex] = useState(todayIndex >= 0 ? todayIndex : 0)
  // Doar la schimbarea săptămânii (weekStart) — nu la fiecare tick al `now` (todayIndex ar
  // reseta selecția utilizatorului în timp ce navighează manual între zile).
  useEffect(() => {
    setMobileDayIndex(todayIndex >= 0 ? todayIndex : 0)
  }, [weekStart])
  const mobileDay = days[mobileDayIndex]!
  const mobileScrollRef = useRef<HTMLDivElement>(null)
  const desktopScrollRef = useRef<HTMLDivElement>(null)
  const hasOccurrences = occurrences.length > 0
  // The grid covers the whole day: it opens at 07:00, or at the first earlier event of the week.
  useEffect(() => {
    const firstHour = occurrences.filter((o) => !o.allDay).reduce((hour, o) => Math.min(hour, new Date(o.occurrenceStart).getHours()), 7)
    for (const box of [mobileScrollRef.current, desktopScrollRef.current]) if (box) box.scrollTop = firstHour * HOUR_HEIGHT
  }, [weekStart, hasOccurrences])
  const mobileDayEvents = layoutDay(occurrences, mobileDay, DAY_GRID)
  const mobileAllDayEvents = allDayOn(occurrences, mobileDay)

  return (
    <div className="rounded-lg border">
      <div className="sm:hidden">
        <div className="flex gap-1 overflow-x-auto border-b p-2">
          {days.map((day, i) => {
            const today = isToday(day)
            return (
              <button
                key={day.toISOString()}
                type="button"
                className={cn(
                  'flex shrink-0 flex-col items-center rounded-md px-2.5 py-1 text-xs',
                  i === mobileDayIndex ? 'bg-primary text-primary-foreground' : today ? 'bg-primary/10 text-primary' : 'text-muted-foreground',
                )}
                onClick={() => setMobileDayIndex(i)}
              >
                <span>{WEEKDAY_LABELS[day.getDay() === 0 ? 6 : day.getDay() - 1]}</span>
                <span className="font-semibold">{day.getDate()}</span>
              </button>
            )
          })}
        </div>
        {mobileAllDayEvents.length > 0 ? (
          <div className="space-y-1 border-b px-2 py-1.5">
            {mobileAllDayEvents.map((occ) => (
              <button
                key={`${occ.eventId}-${occ.occurrenceStart}`}
                type="button"
                className="block w-full truncate rounded px-1.5 py-0.5 text-left text-xs text-white"
                style={{ backgroundColor: occ.color ?? chartColor(0) }}
                onClick={() => onEventClick(occ)}
              >
                {eventLabel(occ)}
              </button>
            ))}
          </div>
        ) : null}
        <div ref={mobileScrollRef} className="max-h-[calc(100dvh-16rem)] overflow-y-auto">
        <div className="grid grid-cols-[48px_1fr]">
          <div>
            {hours.map((h) => (
              <div key={h} className="border-t px-2 text-right text-xs text-muted-foreground" style={{ height: HOUR_HEIGHT }}>
                {String(h).padStart(2, '0')}:00
              </div>
            ))}
          </div>
          <div className="relative border-l" style={{ height: HOUR_HEIGHT * hours.length }}>
            {hours.map((h) => (
              <button
                key={h}
                type="button"
                className="block w-full border-t hover:bg-accent/50"
                style={{ height: HOUR_HEIGHT }}
                onClick={() => {
                  const start = new Date(mobileDay)
                  start.setHours(h, 0, 0, 0)
                  onSlotClick(start, new Date(start.getTime() + 60 * 60 * 1000))
                }}
              />
            ))}
            <BookingLayers day={mobileDay} windows={bookingWindows} blocks={bookingBlocks} onBlockClick={onBlockClick} />
            {mobileDayEvents.map((placed) => {
              const { occ } = placed
              const start = new Date(occ.occurrenceStart)
              const end = new Date(occ.occurrenceEnd)
              return (
                <button
                  key={`${occ.eventId}-${occ.occurrenceStart}`}
                  type="button"
                  className="absolute z-[2] overflow-hidden rounded-md px-1.5 py-1 text-left text-xs text-white ring-1 ring-background"
                  style={{ ...placedStyle(placed), backgroundColor: occ.color ?? chartColor(0) }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onEventClick(occ)
                  }}
                >
                  <EventTitle occ={occ} />
                  <div className="truncate opacity-90">
                    {formatTime(start)}–{formatTime(end)}
                  </div>
                </button>
              )
            })}
            {isToday(mobileDay) && showNowLine ? (
              <div className="pointer-events-none absolute left-0 right-0 z-10 border-t-2 border-destructive-text" style={{ top: nowOffset * HOUR_HEIGHT }}>
                <div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-destructive" />
              </div>
            ) : null}
          </div>
        </div>
        </div>
      </div>

      <div className="hidden sm:block">
      <div className="grid grid-cols-[48px_repeat(7,minmax(0,1fr))] border-b">
        <div />
        {days.map((day) => {
          const today = isToday(day)
          return (
            <div
              key={day.toISOString()}
              className={cn('min-w-0 border-l px-2 py-2 text-center text-sm font-medium', today && 'bg-primary/5')}
            >
              <span className={cn(today ? 'text-primary' : 'text-muted-foreground')}>
                {WEEKDAY_LABELS[day.getDay() === 0 ? 6 : day.getDay() - 1]}
              </span>{' '}
              <span
                className={cn(
                  'inline-flex h-6 w-6 items-center justify-center rounded-full',
                  today && 'bg-primary font-semibold text-primary-foreground',
                )}
              >
                {day.getDate()}
              </span>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-[48px_repeat(7,minmax(0,1fr))] border-b">
        <div className="px-2 py-1 text-right text-xs text-muted-foreground">{t('calendar:week.allDay')}</div>
        {days.map((day) => {
          const allDayEvents = allDayOn(occurrences, day)
          return (
            <div
              key={day.toISOString()}
              className={cn('min-w-0 space-y-1 border-l px-1 py-1', isToday(day) && 'bg-primary/5')}
            >
              {allDayEvents.map((occ) => (
                <button
                  key={`${occ.eventId}-${occ.occurrenceStart}`}
                  type="button"
                  className="block w-full truncate rounded px-1.5 py-0.5 text-left text-xs text-white"
                  style={{ backgroundColor: occ.color ?? chartColor(0) }}
                  onClick={() => onEventClick(occ)}
                >
                  {eventLabel(occ)}
                </button>
              ))}
            </div>
          )
        })}
      </div>

      <div ref={desktopScrollRef} className="max-h-[calc(100dvh-18rem)] overflow-y-auto">
      <div className="grid grid-cols-[48px_repeat(7,minmax(0,1fr))]">
        <div>
          {hours.map((h) => (
            <div key={h} className="border-t px-2 text-right text-xs text-muted-foreground" style={{ height: HOUR_HEIGHT }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        {days.map((day) => {
          const dayEvents = layoutDay(occurrences, day, DAY_GRID)
          const today = isToday(day)
          return (
            <div
              key={day.toISOString()}
              className={cn(
                'relative min-w-0 border-l',
                today && 'bg-primary/5',
                dragOverDay === day.toISOString() && 'bg-accent',
              )}
              style={{ height: HOUR_HEIGHT * hours.length }}
              onDragOver={(e) => {
                if (!draggedOcc) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setDragOverDay(day.toISOString())
              }}
              onDragLeave={() => setDragOverDay((prev) => (prev === day.toISOString() ? null : prev))}
              onDrop={(e) => {
                if (!draggedOcc) return
                e.preventDefault()
                const start = snappedDropTime(e, day)
                const duration = new Date(draggedOcc.occurrenceEnd).getTime() - new Date(draggedOcc.occurrenceStart).getTime()
                onEventDrop(draggedOcc, start, new Date(start.getTime() + duration))
                setDraggedOcc(null)
                setDragOverDay(null)
              }}
            >
              {hours.map((h) => (
                <button
                  key={h}
                  type="button"
                  className="block w-full border-t hover:bg-accent/50"
                  style={{ height: HOUR_HEIGHT }}
                  onClick={() => {
                    const start = new Date(day)
                    start.setHours(h, 0, 0, 0)
                    onSlotClick(start, new Date(start.getTime() + 60 * 60 * 1000))
                  }}
                />
              ))}
              <BookingLayers day={day} windows={bookingWindows} blocks={bookingBlocks} onBlockClick={onBlockClick} />
              {dayEvents.map((placed) => {
                const { occ } = placed
                const start = new Date(occ.occurrenceStart)
                const end = new Date(occ.occurrenceEnd)
                const isDragging = draggedOcc?.eventId === occ.eventId && draggedOcc.occurrenceStart === occ.occurrenceStart
                // O programare de pe site nu se mută prin tragere: ora e promisă vizitatorului prin email.
                const movable = canEditOccurrence(occ) && occ.source !== 'booking'
                return (
                  <button
                    key={`${occ.eventId}-${occ.occurrenceStart}`}
                    type="button"
                    draggable={movable}
                    className={cn(
                      'absolute z-[2] overflow-hidden rounded-md px-1.5 py-1 text-left text-xs text-white ring-1 ring-background',
                      movable && 'cursor-grab active:cursor-grabbing',
                      isDragging && 'opacity-40',
                    )}
                    style={{ ...placedStyle(placed), backgroundColor: occ.color ?? chartColor(0) }}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEventClick(occ)
                    }}
                    onDragStart={(e) => {
                      if (!movable) return
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', occ.eventId)
                      setDraggedOcc(occ)
                    }}
                    onDragEnd={() => {
                      setDraggedOcc(null)
                      setDragOverDay(null)
                    }}
                  >
                    <EventTitle occ={occ} />
                    <div className="truncate opacity-90">{formatTime(start)}–{formatTime(end)}</div>
                  </button>
                )
              })}
              {today && showNowLine ? (
                <div
                  className="pointer-events-none absolute left-0 right-0 z-10 border-t-2 border-destructive-text"
                  style={{ top: nowOffset * HOUR_HEIGHT }}
                >
                  <div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-destructive" />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      </div>
      </div>
    </div>
  )
}
