import { useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { t } from '@/shared/lib/i18n'
import type { CalendarLayer } from '@/shared/lib/types'
import { formatTime } from './date-utils'
import { intlTag } from '@/shared/lib/format'

/**
 * The popover beside a range drawn on the grid (C6, C8): a title, the time already written,
 * the calendar, Enter saves. "More options" opens the full form with what was typed.
 */
export function QuickCreate({
  start,
  end,
  calendars,
  pending,
  onSave,
  onMore,
}: {
  start: Date
  end: Date
  calendars: CalendarLayer[]
  pending: boolean
  onSave: (title: string, calendarOwnerId: string | null) => void
  onMore: (title: string) => void
}) {
  const [title, setTitle] = useState('')
  const [calendarOwnerId, setCalendarOwnerId] = useState(calendars.find((c) => c.owner)?.userId ?? '')
  const day = new Intl.DateTimeFormat(intlTag(), { weekday: 'long', day: 'numeric', month: 'long' }).format(start)

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        const mine = calendars.find((c) => c.owner)?.userId
        onSave(title.trim() || t('calendar:quick.untitled'), calendarOwnerId && calendarOwnerId !== mine ? calendarOwnerId : null)
      }}
    >
      <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('calendar:quick.titlePlaceholder')} aria-label={t('common:labels.title')} />
      <p className="text-sm text-muted-foreground">
        {day} · {formatTime(start)}–{formatTime(end)}
      </p>
      {calendars.length > 1 ? (
        <Select aria-label={t('common:nav.calendar')} value={calendarOwnerId} onValueChange={setCalendarOwnerId}>
          {calendars.map((cal) => (
            <option key={cal.userId} value={cal.userId}>
              {cal.owner ? t('calendar:layers.mine') : t('calendar:layers.calendarOf', { name: cal.name })}
            </option>
          ))}
        </Select>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => onMore(title)}>
          {t('calendar:quick.more')}
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? t('common:states.saving') : t('common:actions.save')}
        </Button>
      </div>
    </form>
  )
}
