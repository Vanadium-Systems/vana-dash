import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'
import { t } from '@/shared/lib/i18n'
import { addDays, addMonths, isSameDay, isToday, MONTH_LABELS, startOfMonth, startOfWeek, WEEKDAY_LABELS } from './date-utils'

interface MiniCalendarProps {
  month: Date
  selected: Date
  onSelect: (day: Date) => void
  onMonthChange: (month: Date) => void
}

export function MiniCalendar({ month, selected, onSelect, onMonthChange }: MiniCalendarProps) {
  const grid = useRef<HTMLDivElement>(null)
  const gridStart = startOfWeek(startOfMonth(month))
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
  const selectedWeek = startOfWeek(selected).getTime()
  // One tab stop for the whole grid: the selected day, or the first of the month when it is elsewhere.
  const tabStop = days.find((day) => isSameDay(day, selected)) ?? startOfMonth(month)

  const moveFocus = (from: Date, by: number) => {
    const target = addDays(from, by)
    if (target.getMonth() !== month.getMonth() || target.getFullYear() !== month.getFullYear()) onMonthChange(startOfMonth(target))
    // The grid re-renders for the new month before the next frame; focus the day by its date.
    requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-day="${target.getTime()}"]`)?.focus())
  }

  const keyStep: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }

  return (
    <div className="w-[216px]">
      <div className="mb-1 flex items-center justify-between">
        <span className="px-1 text-sm font-medium capitalize">
          {MONTH_LABELS[month.getMonth()]} {month.getFullYear()}
        </span>
        <div className="flex">
          <Button variant="ghost" size="icon-sm" aria-label={t('calendar:mini.prevMonth')} onClick={() => onMonthChange(addMonths(startOfMonth(month), -1))}>
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t('calendar:mini.nextMonth')} onClick={() => onMonthChange(addMonths(startOfMonth(month), 1))}>
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7" aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="h-7 text-center text-xs leading-7 text-muted-foreground">
            {label.slice(0, 2)}
          </div>
        ))}
      </div>
      <div ref={grid} className="grid grid-cols-7" role="group" aria-label={t('calendar:mini.label')}>
        {days.map((day) => {
          const inMonth = day.getMonth() === month.getMonth()
          const chosen = isSameDay(day, selected)
          return (
            <button
              key={day.getTime()}
              type="button"
              data-day={day.getTime()}
              tabIndex={isSameDay(day, tabStop) ? 0 : -1}
              aria-pressed={chosen}
              aria-current={isToday(day) ? 'date' : undefined}
              className={cn(
                'h-7 w-7 justify-self-center rounded-md text-xs tabular-nums transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                !inMonth && 'text-muted-foreground',
                startOfWeek(day).getTime() === selectedWeek && 'bg-accent',
                chosen && 'font-semibold text-foreground',
                isToday(day) && 'ring-1 ring-foreground',
              )}
              onClick={() => onSelect(day)}
              onKeyDown={(e) => {
                const step = keyStep[e.key]
                if (step === undefined) return
                e.preventDefault()
                moveFocus(day, step)
              }}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}
