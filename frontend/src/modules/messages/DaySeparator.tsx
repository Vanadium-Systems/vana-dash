import { CalendarDays } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { companyTimeZone, formatDate } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'

// The day chip between messages. It sticks to the top while its day scrolls by, and it is a
// menu for jumping to another day (#6, #34). Stuck at the top it covers the first message, so
// there it shows only while the thread scrolls and fades out once the scrolling stops.

const IDLE_MS = 1200

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
  const [stuck, setStuck] = useState(false)
  const [scrolling, setScrolling] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const now = Date.now()

  useEffect(() => {
    const root = wrapRef.current?.closest<HTMLElement>('[data-thread-scroll]')
    const el = wrapRef.current
    if (!root || !el) return
    // Stuck = its top sits above the root's top edge minus the sticky offset (top-1 = 4px).
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!!entry && !!entry.rootBounds && entry.boundingClientRect.top < entry.rootBounds.top),
      { root, threshold: [1], rootMargin: '-5px 0px 0px 0px' },
    )
    observer.observe(el)
    let timer: ReturnType<typeof setTimeout> | undefined
    const onScroll = () => {
      setScrolling(true)
      clearTimeout(timer)
      timer = setTimeout(() => setScrolling(false), IDLE_MS)
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      observer.disconnect()
      root.removeEventListener('scroll', onScroll)
      clearTimeout(timer)
    }
  }, [])

  const hidden = stuck && !scrolling && !open
  return (
    <div ref={wrapRef} className="pointer-events-none sticky top-1 z-10 flex justify-center py-1.5">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger className={cn('rounded-full transition-opacity duration-fast', hidden ? 'opacity-0 focus-visible:pointer-events-auto focus-visible:opacity-100' : 'pointer-events-auto', 'border bg-background px-3 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}>
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
      {/* native: visually hidden date picker, opened from the menu */}
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
