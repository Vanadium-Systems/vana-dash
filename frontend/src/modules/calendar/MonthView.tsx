import { cn } from '@/shared/lib/utils'
import type { CalendarOccurrence } from '@/shared/lib/types'
import { addDays, formatTime, isSameDay, isToday, MONTH_LABELS, startOfMonth, startOfWeek, WEEKDAY_LABELS } from './date-utils'
import { eventLabel } from '@/shared/lib/event-label'
import { eventColors } from '@/shared/lib/tag-colors'
import { t } from '@/shared/lib/i18n'
import { allDayOn } from './week-layout'

const MAX_VISIBLE_PER_DAY = 3

interface MonthViewProps {
  monthDate: Date
  occurrences: CalendarOccurrence[]
  onDayClick: (day: Date) => void
  onEventClick: (occurrence: CalendarOccurrence) => void
  /** The "+N" button: gets the day's events and the button, to anchor a popover on. */
  onMoreClick?: (day: Date, occurrences: CalendarOccurrence[], anchor: HTMLElement) => void
  selectedDay?: Date
}

/** All-day events first, then by start; a multi-day all-day event shows on every day it covers. */
function eventsOn(occurrences: CalendarOccurrence[], day: Date): CalendarOccurrence[] {
  const timed = occurrences.filter((occ) => !occ.allDay && isSameDay(new Date(occ.occurrenceStart), day))
  const byStart = (a: CalendarOccurrence, b: CalendarOccurrence) => new Date(a.occurrenceStart).getTime() - new Date(b.occurrenceStart).getTime()
  return [...allDayOn(occurrences, day).sort(byStart), ...timed.sort(byStart)]
}

export function MonthView({ monthDate, occurrences, onDayClick, onEventClick, onMoreClick, selectedDay }: MonthViewProps) {
  const gridStart = startOfWeek(startOfMonth(monthDate))
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const currentMonth = monthDate.getMonth()

  return (
    <div className="rounded-lg border">
      <div className="grid grid-cols-7 border-b">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="px-1 py-2 text-center text-xs font-medium text-muted-foreground sm:px-2 sm:text-sm">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dayEvents = eventsOn(occurrences, day)
          const visible = dayEvents.slice(0, MAX_VISIBLE_PER_DAY)
          const isCurrentMonth = day.getMonth() === currentMonth
          const today = isToday(day)
          const selected = selectedDay ? isSameDay(day, selectedDay) : false
          return (
            // Nu <button> — ar conține alte elemente interactive (chip-urile de eveniment de mai
            // jos), nesting invalid HTML (button în button). div + role="button" + onKeyDown
            // păstrează accesibilitatea de la tastatură fără restricția de conținut a <button>.
            <div
              key={day.toISOString()}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              className={cn(
                'min-h-14 min-w-0 cursor-pointer space-y-1 border-b border-l p-1 text-left align-top transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:min-h-24',
                !isCurrentMonth && 'bg-muted/30 text-muted-foreground',
                today && 'bg-primary/5',
                selected && 'bg-accent hover:bg-accent',
              )}
              onClick={() => onDayClick(day)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onDayClick(day)
                }
              }}
            >
              <div className={cn('text-xs', selected && 'font-medium text-foreground')}>
                {day.getDate() === 1 ? `${(MONTH_LABELS[day.getMonth()] ?? '').slice(0, 3)} ` : ''}
                <span
                  className={cn(
                    today && 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground',
                  )}
                >
                  {day.getDate()}
                </span>
              </div>
              {dayEvents.length > 0 ? (
                <div className="flex gap-1 sm:hidden" role="img" aria-label={t('calendar:month.events', { count: dayEvents.length })}>
                  {visible.map((occ) => (
                    <span key={`${occ.eventId}-${occ.occurrenceStart}`} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: eventColors(occ.color, occ.ownerUserId).background }} />
                  ))}
                </div>
              ) : null}
              <div className="hidden space-y-1 sm:block">
                {visible.map((occ) => (
                  <button
                    key={`${occ.eventId}-${occ.occurrenceStart}`}
                    type="button"
                    className={cn(
                      'flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left text-xs',
                      occ.allDay ? '' : 'text-foreground hover:bg-accent',
                    )}
                    style={occ.allDay ? { backgroundColor: eventColors(occ.color, occ.ownerUserId).background, color: eventColors(occ.color, occ.ownerUserId).color } : undefined}
                    onClick={(e) => {
                      e.stopPropagation()
                      onEventClick(occ)
                    }}
                  >
                    {occ.allDay ? null : (
                      <>
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: eventColors(occ.color, occ.ownerUserId).background }} aria-hidden="true" />
                        <span className="shrink-0 tabular-nums text-muted-foreground">{formatTime(new Date(occ.occurrenceStart))}</span>
                      </>
                    )}
                    <span className="truncate">{eventLabel(occ)}</span>
                  </button>
                ))}
                {dayEvents.length > MAX_VISIBLE_PER_DAY ? (
                  <button
                    type="button"
                    className="block rounded px-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (onMoreClick) onMoreClick(day, dayEvents, e.currentTarget)
                      else onDayClick(day)
                    }}
                  >
                    {t('calendar:month.more', { count: dayEvents.length - MAX_VISIBLE_PER_DAY })}
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
