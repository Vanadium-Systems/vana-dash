import type { ReactNode } from 'react'
import { formatDate, formatDateTime, formatRelativeTime } from '@/shared/lib/format'

export interface TimelineEntry {
  id: string
  author: string | null
  at: string | Date
  text: ReactNode
}

/** Consecutive entries on the same calendar day (company time zone) share one heading. */
export function groupByDay(entries: TimelineEntry[]): { day: string; entries: TimelineEntry[] }[] {
  const groups: { day: string; entries: TimelineEntry[] }[] = []
  for (const entry of entries) {
    const day = formatDate(entry.at)
    const last = groups.at(-1)
    if (last?.day === day) last.entries.push(entry)
    else groups.push({ day, entries: [entry] })
  }
  return groups
}

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  return (
    <div className="space-y-4 text-sm">
      {groupByDay(entries).map((group) => (
        <section key={group.day}>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">{group.day}</h3>
          <ul className="space-y-3">
            {group.entries.map((entry) => (
              <li key={entry.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0">
                    {entry.author ? <span className="font-medium">{entry.author} </span> : null}
                    {entry.text}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground" title={formatDateTime(entry.at)}>
                    {formatRelativeTime(entry.at)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
