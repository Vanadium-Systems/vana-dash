import { useMemo } from 'react'
import { Button } from '@/shared/components/ui/button'
import { eventLabel } from '@/shared/lib/event-label'
import { intlTag } from '@/shared/lib/format'
import { eventColors } from '@/shared/lib/tag-colors'
import { t } from '@/shared/lib/i18n'
import type { CalendarOccurrence } from '@/shared/lib/types'
import { groupAgenda } from './agenda'
import { formatTime, isToday } from './date-utils'

interface AgendaViewProps {
  from: Date
  occurrences: CalendarOccurrence[]
  onEventClick: (occurrence: CalendarOccurrence) => void
  onLoadMore: () => void
  hasMore: boolean
}

function timeRange(occ: CalendarOccurrence): string {
  if (occ.allDay) return t('calendar:agenda.allDay')
  return `${formatTime(new Date(occ.occurrenceStart))} – ${formatTime(new Date(occ.occurrenceEnd))}`
}

export function AgendaView({ from, occurrences, onEventClick, onLoadMore, hasMore }: AgendaViewProps) {
  const days = useMemo(() => groupAgenda(occurrences, from), [occurrences, from])

  return (
    <div className="space-y-4" role="list" aria-label={t('calendar:agenda.label')}>
      {days.map(({ day, items }) => {
        const today = isToday(day)
        const heading = new Intl.DateTimeFormat(intlTag(), { weekday: 'long', day: 'numeric', month: 'long' }).format(day)
        return (
          <section key={day.getTime()} role="listitem">
            <h3 className="px-2 pb-1 text-sm font-medium text-muted-foreground">
              {today ? <span className="text-foreground">{t('calendar:agenda.today')}</span> : null}
              {today ? ' · ' : null}
              {heading}
            </h3>
            {items.length === 0 ? (
              <p className="px-2 py-2 text-sm text-muted-foreground">{t('calendar:agenda.empty')}</p>
            ) : (
              <ul>
                {items.map((occ) => (
                  <li key={`${occ.eventId}-${occ.occurrenceStart}`}>
                    <button
                      type="button"
                      className="flex h-10 w-full min-w-0 items-center gap-3 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => onEventClick(occ)}
                    >
                      <span className="w-28 shrink-0 text-muted-foreground tabular-nums">{timeRange(occ)}</span>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: eventColors(occ.color, occ.ownerUserId).background }} aria-hidden="true" />
                      <span className="min-w-0 truncate">{eventLabel(occ)}</span>
                      {occ.location ? <span className="hidden min-w-0 truncate text-muted-foreground sm:inline">{occ.location}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
      {hasMore ? (
        <div className="px-2">
          <Button variant="outline" onClick={onLoadMore}>
            {t('calendar:agenda.more')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
