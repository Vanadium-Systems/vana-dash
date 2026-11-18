import { CalendarRange } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { Input } from '@/shared/components/ui/input'
import { ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { companyTimeZone, formatDate, zonedDayEnd, zonedDayStart } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'

// A period as [from, to] ISO days (yyyy-mm-dd), either side open. The days are the company's, not the browser's.

export type DayRange = [string | null, string | null]
type Preset = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear'
const PRESETS: Preset[] = ['thisMonth', 'lastMonth', 'thisQuarter', 'thisYear']

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`
const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate()

/** Today's day in the company's zone. */
export function companyToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: companyTimeZone() }).format(now)
}

export function presetRange(preset: Preset, today: string = companyToday()): DayRange {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  if (preset === 'thisMonth') return [iso(year, month, 1), iso(year, month, lastDayOf(year, month))]
  if (preset === 'lastMonth') {
    const [y, m] = month === 1 ? [year - 1, 12] : [year, month - 1]
    return [iso(y, m, 1), iso(y, m, lastDayOf(y, m))]
  }
  if (preset === 'thisQuarter') {
    const first = Math.floor((month - 1) / 3) * 3 + 1
    return [iso(year, first, 1), iso(year, first + 2, lastDayOf(year, first + 2))]
  }
  return [iso(year, 1, 1), iso(year, 12, 31)]
}

function activePreset(value: DayRange): Preset | 'custom' | null {
  if (!value[0] && !value[1]) return null
  return PRESETS.find((preset) => {
    const [from, to] = presetRange(preset)
    return from === value[0] && to === value[1]
  }) ?? 'custom'
}

export function periodLabel(value: DayRange): string {
  const active = activePreset(value)
  if (!active) return t('common:filterBar.period.any')
  if (active !== 'custom') return t(`common:filterBar.period.${active}`)
  const show = (day: string | null) => (day ? formatDate(`${day}T12:00:00`) : '')
  return [show(value[0]), show(value[1])].join(' - ')
}

/** The options themselves, for a menu or a dialog that already exists. */
export function PeriodOptions({ value, onChange }: { value: DayRange; onChange: (next: DayRange) => void }) {
  const active = activePreset(value)
  const [custom, setCustom] = useState(active === 'custom')
  return (
    <div className="space-y-1">
      {PRESETS.map((preset) => (
        <Button key={preset} type="button" variant="ghost" aria-pressed={active === preset} className="w-full justify-start aria-pressed:bg-accent" onClick={() => { setCustom(false); onChange(presetRange(preset)) }}>
          {t(`common:filterBar.period.${preset}`)}
        </Button>
      ))}
      <Button type="button" variant="ghost" aria-pressed={custom} className="w-full justify-start aria-pressed:bg-accent" onClick={() => setCustom(true)}>
        {t('common:filterBar.period.custom')}
      </Button>
      {custom ? (
        <div className="grid grid-cols-2 gap-2 px-1 pt-1">
          <label className="space-y-1 text-xs text-muted-foreground">
            {t('common:filterBar.period.from')}
            <Input type="date" value={value[0] ?? ''} onChange={(e) => onChange([e.target.value || null, value[1]])} />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            {t('common:filterBar.period.to')}
            <Input type="date" value={value[1] ?? ''} onChange={(e) => onChange([value[0], e.target.value || null])} />
          </label>
        </div>
      ) : null}
    </div>
  )
}

/** One menu: this month, last month, this quarter, this year or a range. */
export function PeriodSelect({ value, onChange }: { value: DayRange; onChange: (next: DayRange) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger className="inline-flex h-control-md items-center gap-2 rounded-md border bg-background px-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <CalendarRange className="h-4 w-4" aria-hidden="true" /> {periodLabel(value)}
      </DropdownMenuTrigger>
      <ResponsiveMenuContent title={t('common:filterBar.period.label')} align="start">
        <PeriodOptions
          value={value}
          onChange={(next) => {
            onChange(next)
            // A preset is a whole answer; a custom range still needs its second date.
            if (activePreset(next) !== 'custom') setOpen(false)
          }}
        />
      </ResponsiveMenuContent>
    </DropdownMenu>
  )
}

// The period of a screen that lives in the URL: ?period=7d|30d|90d|mtd|ytd|lastMonth|thisQuarter, or
// ?period=custom&from=yyyy-mm-dd&to=yyyy-mm-dd. Anything missing, unknown or incomplete is 30d.

const WINDOWS = ['7d', '30d', '90d', 'mtd', 'ytd']
const RANGE_PERIODS = ['lastMonth', 'thisQuarter']
const DEFAULT_PERIOD = '30d'

export interface PeriodParams {
  period: string
  from?: string
  to?: string
}

export interface ResolvedPeriod {
  period: string
  /** Ready for a request: `period=<token>` for the five windows, `from=<ISO>&to=<ISO>` for the rest. */
  query: string
  /** The explicit span, null for the five windows (the server resolves those). */
  range: { from: string; to: string } | null
  /** Stable across renders and free of the current time: for queryKeys. */
  cacheKey: string
}

export function isDay(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function parsePeriod(searchParams: URLSearchParams): PeriodParams {
  const period = searchParams.get('period') ?? DEFAULT_PERIOD
  if (WINDOWS.includes(period) || RANGE_PERIODS.includes(period)) return { period }
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if (period === 'custom' && isDay(from) && isDay(to) && from <= to) return { period, from, to }
  return { period: DEFAULT_PERIOD }
}

export function resolvePeriod({ period, from, to }: PeriodParams, now: Date = new Date(), timeZone: string = companyTimeZone()): ResolvedPeriod {
  if (WINDOWS.includes(period)) return { period, query: `period=${period}`, range: null, cacheKey: period }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone }).format(now)
  const [firstDay, lastDay] = period === 'custom' ? [from!, to!] : (presetRange(period as Preset, today) as [string, string])
  const start = zonedDayStart(firstDay, timeZone)
  const end = new Date(Math.min(zonedDayEnd(lastDay, timeZone).getTime(), now.getTime()))
  const range = { from: start.toISOString(), to: end.toISOString() }
  return { period, query: `from=${range.from}&to=${range.to}`, range, cacheKey: `${period}:${firstDay}:${lastDay}` }
}

export function granularityFor(period: string, range: { from: string; to: string } | null): 'day' | 'week' | 'month' {
  if (range) {
    const days = (Date.parse(range.to) - Date.parse(range.from)) / 86_400_000
    return days <= 31 ? 'day' : days <= 120 ? 'week' : 'month'
  }
  if (period === 'ytd') return 'month'
  if (period === '90d') return 'week'
  return 'day'
}

/** The URL after choosing a period: other parameters stay, from/to only exist for a custom range. */
export function withPeriod(current: URLSearchParams, period: string, days?: { from: string; to: string }): URLSearchParams {
  const next = new URLSearchParams(current)
  next.set('period', period)
  next.delete('from')
  next.delete('to')
  if (period === 'custom' && days) {
    next.set('from', days.from)
    next.set('to', days.to)
  }
  return next
}

/** The period in the URL, resolved once per change: the objects are the same between renders. */
export function usePeriod(): ResolvedPeriod {
  const [searchParams] = useSearchParams()
  const { period, from, to } = parsePeriod(searchParams)
  const timeZone = companyTimeZone()
  // `now` is read when the URL changes, not per render: a new ISO string per render is a new queryKey.
  return useMemo(() => resolvePeriod({ period, from, to }, new Date(), timeZone), [period, from, to, timeZone])
}

/** The options of the menus that read the URL, in order. */
export function periodChoices(): { value: string; label: string }[] {
  return [
    { value: '7d', label: t('common:labels.days7') },
    { value: '30d', label: t('common:labels.days30') },
    { value: '90d', label: t('common:labels.days90') },
    { value: 'mtd', label: t('common:period.currentMonth') },
    { value: 'ytd', label: t('common:period.currentYear') },
    { value: 'lastMonth', label: t('common:filterBar.period.lastMonth') },
    { value: 'thisQuarter', label: t('common:filterBar.period.thisQuarter') },
  ]
}

const choiceClass = 'w-full justify-start aria-pressed:bg-accent'

/** The same menu as PeriodSelect, bound to the URL. */
export function UrlPeriodSelect() {
  const [searchParams, setSearchParams] = useSearchParams()
  const current = parsePeriod(searchParams)
  const [open, setOpen] = useState(false)
  const [customOpen, setCustomOpen] = useState(current.period === 'custom')
  const [draft, setDraft] = useState<[string, string]>([current.from ?? '', current.to ?? ''])
  const choices = periodChoices()
  const choose = (period: string, days?: { from: string; to: string }) => setSearchParams((prev) => withPeriod(prev, period, days))
  const pick = (period: string) => {
    setCustomOpen(false)
    choose(period)
    setOpen(false)
  }
  const editDraft = (next: [string, string]) => {
    setDraft(next)
    if (isDay(next[0]) && isDay(next[1]) && next[0] <= next[1]) choose('custom', { from: next[0], to: next[1] })
  }
  const label =
    current.period === 'custom'
      ? [current.from, current.to].map((day) => formatDate(`${day}T12:00:00`)).join(' - ')
      : choices.find((choice) => choice.value === current.period)?.label
  const option = (choice: { value: string; label: string }) => (
    <Button key={choice.value} type="button" variant="ghost" aria-pressed={!customOpen && current.period === choice.value} className={choiceClass} onClick={() => pick(choice.value)}>
      {choice.label}
    </Button>
  )
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger className="inline-flex h-control-md items-center gap-2 rounded-md border bg-background px-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <CalendarRange className="h-4 w-4" aria-hidden="true" /> {label}
      </DropdownMenuTrigger>
      <ResponsiveMenuContent title={t('common:period.label')} align="start">
        <div className="space-y-1">
          {choices.slice(0, 5).map(option)}
          <div role="separator" className="my-1 h-px bg-border" />
          {choices.slice(5).map(option)}
          <Button type="button" variant="ghost" aria-pressed={customOpen} className={choiceClass} onClick={() => setCustomOpen(true)}>
            {t('common:filterBar.period.custom')}
          </Button>
          {customOpen ? (
            <div className="grid grid-cols-2 gap-2 px-1 pt-1">
              <label className="space-y-1 text-xs text-muted-foreground">
                {t('common:filterBar.period.from')}
                <Input type="date" value={draft[0]} onChange={(e) => editDraft([e.target.value, draft[1]])} />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                {t('common:filterBar.period.to')}
                <Input type="date" value={draft[1]} onChange={(e) => editDraft([draft[0], e.target.value])} />
              </label>
            </div>
          ) : null}
        </div>
      </ResponsiveMenuContent>
    </DropdownMenu>
  )
}
