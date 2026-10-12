import { chartColor } from '@/shared/lib/chart-colors'
import { cn } from '@/shared/lib/utils'
import type { CalendarOccurrence } from '@/shared/lib/types'
import { addDays, isSameDay, isToday, MONTH_LABELS, startOfMonth, startOfWeek, WEEKDAY_LABELS } from './date-utils'
import { eventLabel } from '@/shared/lib/event-label'
import { t } from '@/shared/lib/i18n'

const MAX_VISIBLE_PER_DAY = 3

interface MonthViewProps {
  monthDate: Date
  occurrences: CalendarOccurrence[]
  onDayClick: (day: Date) => void
  onEventClick: (occurrence: CalendarOccurrence) => void
}

export function MonthView({ monthDate, occurrences, onDayClick, onEventClick }: MonthViewProps) {
  const gridStart = startOfWeek(startOfMonth(monthDate))
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const currentMonth = monthDate.getMonth()

  return (
    <div className="rounded-lg border">
      <div className="grid grid-cols-7 border-b">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="px-2 py-2 text-center text-sm font-medium">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dayEvents = occurrences.filter((o) => isSameDay(new Date(o.occurrenceStart), day))
          const visible = dayEvents.slice(0, MAX_VISIBLE_PER_DAY)
          const isCurrentMonth = day.getMonth() === currentMonth
          const today = isToday(day)
          return (
            // Nu <button> — ar conține alte elemente interactive (chip-urile de eveniment de mai
            // jos), nesting invalid HTML (button în button). div + role="button" + onKeyDown
            // păstrează accesibilitatea de la tastatură fără restricția de conținut a <button>.
            <div
              key={day.toISOString()}
              role="button"
              tabIndex={0}
              className={cn(
                'min-h-24 min-w-0 cursor-pointer space-y-1 border-b border-l p-1 text-left align-top',
                !isCurrentMonth && 'bg-muted/30 text-muted-foreground',
                today && 'bg-primary/5',
              )}
              onClick={() => onDayClick(day)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onDayClick(day)
              }}
            >
              <div className="text-xs">
                {day.getDate() === 1 ? `${(MONTH_LABELS[day.getMonth()] ?? '').slice(0, 3)} ` : ''}
                <span
                  className={cn(
                    today && 'inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground',
                  )}
                >
                  {day.getDate()}
                </span>
              </div>
              {visible.map((occ) => (
                <button
                  key={`${occ.eventId}-${occ.occurrenceStart}`}
                  type="button"
                  className="block w-full animate-in truncate rounded px-1 py-0.5 text-left text-xs text-white fade-in-0 duration-200 ease-out"
                  style={{ backgroundColor: occ.color ?? chartColor(0) }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onEventClick(occ)
                  }}
                >
                  {eventLabel(occ)}
                </button>
              ))}
              {dayEvents.length > MAX_VISIBLE_PER_DAY ? (
                <div className="text-xs text-muted-foreground">{t('calendar:month.more', { count: dayEvents.length - MAX_VISIBLE_PER_DAY })}</div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
