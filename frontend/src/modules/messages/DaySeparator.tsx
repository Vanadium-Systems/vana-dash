import { CalendarDays } from 'lucide-react'
import { useRef, useState } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { companyTimeZone, formatDate } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'

// The day chip between messages. It sticks to the top while its day scrolls by, and it is a
// menu for jumping to another day (#6, #34).

const DAY_MS = 24 * 60 * 60 * 1000

/** YYYY-MM-DD in the company's zone: the key that decides when a new day starts. */
export function dayKey(iso: string | number | Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: companyTimeZone(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

export function dayLabel(iso: string, now = new Date()): string {
  const key = dayKey(iso)
  if (key === dayKey(now)) return t('messages:day.today')
  if (key === dayKey(now.getTime() - DAY_MS)) return t('messages:day.yesterday')
  if (now.getTime() - Date.parse(iso) < 6 * DAY_MS) return formatDate(iso, { weekday: 'long' })
  return formatDate(iso, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Midnight of a YYYY-MM-DD in the company's zone, as an ISO instant (offset from the zone). */
function startOfDay(key: string): string {
  const noonUtc = new Date(`${key}T12:00:00Z`)
  const zoned = new Date(noonUtc.toLocaleString('en-US', { timeZone: companyTimeZone() }))
  const offsetMs = zoned.getTime() - new Date(noonUtc.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
  return new Date(Date.parse(`${key}T00:00:00Z`) - offsetMs).toISOString()
}

export function DaySeparator({ iso, onJump }: { iso: string; onJump: (dateIso: string) => void }) {
  const [open, setOpen] = useState(false)
  const dateRef = useRef<HTMLInputElement>(null)
  const now = Date.now()
  return (
    <div className="pointer-events-none sticky top-1 z-10 flex justify-center py-1.5">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger className="pointer-events-auto rounded-full border bg-background px-3 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {dayLabel(iso)}
          <span className="sr-only">{t('messages:day.jumpMenu')}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => onJump(startOfDay(dayKey(now)))}>{t('messages:day.today')}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onJump(startOfDay(dayKey(now - 7 * DAY_MS)))}>{t('messages:day.lastWeek')}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onJump(startOfDay(dayKey(now - 30 * DAY_MS)))}>{t('messages:day.lastMonth')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setTimeout(() => dateRef.current?.showPicker?.() ?? dateRef.current?.click(), 0)}>
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            {t('messages:day.pickDate')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={dateRef}
        type="date"
        max={dayKey(now)}
        className="sr-only"
        tabIndex={-1}
        aria-label={t('messages:day.pickDate')}
        onChange={(e) => {
          if (e.target.value) onJump(startOfDay(e.target.value))
        }}
      />
    </div>
  )
}
