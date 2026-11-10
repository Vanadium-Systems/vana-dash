import { CalendarRange } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { Input } from '@/shared/components/ui/input'
import { ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { companyTimeZone, formatDate } from '@/shared/lib/format'
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
