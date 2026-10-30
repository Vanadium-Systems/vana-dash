import { Clock } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { formatDateTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { toDatetimeLocalValue } from '@/modules/calendar/date-utils'

export interface SnoozeOption {
  key: 'laterToday' | 'tomorrow' | 'nextWeek'
  at: Date
}

/** Gmail's choices: later today (18:00, only before 17:00), tomorrow 08:00, next Monday 08:00. */
export function snoozeOptions(now: Date): SnoozeOption[] {
  const at = (daysAhead: number, hour: number) => {
    const date = new Date(now)
    date.setDate(date.getDate() + daysAhead)
    date.setHours(hour, 0, 0, 0)
    return date
  }
  const untilMonday = ((8 - now.getDay()) % 7) || 7
  const options: SnoozeOption[] = []
  if (now.getHours() < 17) options.push({ key: 'laterToday', at: at(0, 18) })
  options.push({ key: 'tomorrow', at: at(1, 8) })
  options.push({ key: 'nextWeek', at: at(untilMonday, 8) })
  return options
}

/** The "snooze" button: a menu of ready times plus a date picker. `onSnooze` gets an ISO time. */
export function SnoozeMenu({ onSnooze, disabled }: { onSnooze: (untilIso: string) => void; disabled?: boolean }) {
  const [picking, setPicking] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="inline-flex h-control-md items-center justify-center rounded-md border border-input bg-card px-2.5 hover:bg-accent disabled:opacity-50"
        >
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">{t('email:snooze.title')}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {snoozeOptions(new Date()).map((option) => (
            <DropdownMenuItem key={option.key} onClick={() => !disabled && onSnooze(option.at.toISOString())}>
              <span className="flex-1">{t(`email:snooze.${option.key}`)}</span>
              <span className="text-xs text-muted-foreground">{formatDateTime(option.at)}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            onClick={() => {
              const tomorrow = snoozeOptions(new Date()).find((option) => option.key === 'tomorrow')
              setValue(tomorrow ? toDatetimeLocalValue(tomorrow.at) : '')
              setError(null)
              setPicking(true)
            }}
          >
            {t('email:snooze.pick')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {picking ? (
        <Dialog open onOpenChange={(open) => !open && setPicking(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('email:snooze.title')}</DialogTitle>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                const until = new Date(value)
                if (!value || Number.isNaN(until.getTime()) || until <= new Date()) return setError(t('email:snooze.future'))
                onSnooze(until.toISOString())
                setPicking(false)
              }}
            >
              <Field label={t('email:snooze.until')} error={error}>
                <Input id="snooze-until" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
              </Field>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setPicking(false)}>
                  {t('common:actions.cancel')}
                </Button>
                <Button type="submit" disabled={disabled}>{t('email:snooze.confirm')}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
