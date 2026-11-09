import { Bell, CalendarDays, Copy, Link2, MapPin, MessageSquareShare, MoreHorizontal, Pencil, Repeat, Trash2, Users } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/shared/components/ui/button'
import { DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { ResponsiveMenu, ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { intlTag } from '@/shared/lib/format'
import { eventColors } from '@/shared/lib/tag-colors'
import { t } from '@/shared/lib/i18n'
import type { CalendarOccurrence } from '@/shared/lib/types'
import { formatTime } from './date-utils'
import { describeRule } from './recurrence'

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:h-4 [&_svg]:w-4" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function whenText(occ: CalendarOccurrence): string {
  const start = new Date(occ.occurrenceStart)
  const end = new Date(occ.occurrenceEnd)
  // The grid runs on the browser's clock (PLAN.md decision), so the day here does too.
  const day = new Intl.DateTimeFormat(intlTag(), { weekday: 'long', day: 'numeric', month: 'long' }).format(start)
  if (occ.allDay) return `${day} · ${t('calendar:week.allDay')}`
  return `${day} · ${formatTime(start)}–${formatTime(end)}`
}

/**
 * What an event is, before editing it (C12, C34): read first, act from the bar. Edit, delete
 * and duplicate at sight; sharing and the link in ⋯. A calendar shared "view" says why there is
 * nothing to change.
 */
export function EventReadView({
  occ,
  canEdit,
  canDuplicate,
  canShare,
  onEdit,
  onDelete,
  onDuplicate,
  onShare,
  onCopyLink,
}: {
  occ: CalendarOccurrence
  canEdit: boolean
  canDuplicate: boolean
  canShare: boolean
  onEdit: () => void
  onDelete: () => void
  onDuplicate: () => void
  onShare: () => void
  onCopyLink: () => void
}) {
  const people = occ.isCommon && occ.ownerName ? [occ.ownerName, ...occ.attendees.map((a) => a.name)] : []
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="mt-1.5 h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: eventColors(occ.color, occ.ownerUserId).background }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-lg font-semibold leading-snug">{occ.title}</h2>
          <p className="text-sm text-muted-foreground">{whenText(occ)}</p>
        </div>
      </div>

      <div className="space-y-3">
        {occ.isRecurring ? (
          <Row icon={<Repeat />}>
            {describeRule(occ.recurrenceRule, new Date(occ.seriesStart), occ.recurrenceEndAt ? new Date(occ.recurrenceEndAt) : null)}
            {occ.isException ? <span className="text-muted-foreground"> · {t('calendar:read.changedOnce')}</span> : null}
          </Row>
        ) : null}
        {occ.location ? (
          <Row icon={<MapPin />}>
            <span className="break-words">{occ.location}</span>
          </Row>
        ) : null}
        {people.length > 0 ? (
          <Row icon={<Users />}>
            <span className="break-words">{people.join(', ')}</span>
          </Row>
        ) : null}
        {occ.reminders.length > 0 ? (
          <Row icon={<Bell />}>{t('calendar:read.reminders', { count: occ.reminders.length })}</Row>
        ) : null}
        {occ.ownerName && occ.access !== 'owner' ? (
          <Row icon={<CalendarDays />}>
            {t('calendar:read.inCalendarOf', { name: occ.ownerName })}
            {!canEdit ? <span className="block text-muted-foreground">{t('calendar:read.viewOnly', { name: occ.ownerName })}</span> : null}
          </Row>
        ) : null}
        {occ.description ? <p className="line-clamp-6 whitespace-pre-wrap break-words text-sm">{occ.description}</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t pt-3 max-sm:sticky max-sm:bottom-0 max-sm:bg-card">
        {canEdit ? (
          <Button size="sm" onClick={onEdit}>
            <Pencil className="h-4 w-4" /> {t('common:actions.edit')}
            <kbd className="ml-1 font-sans text-xs opacity-70 max-sm:hidden">E</kbd>
          </Button>
        ) : null}
        {canDuplicate ? (
          <Button size="sm" variant="outline" onClick={onDuplicate}>
            <Copy className="h-4 w-4" /> {t('calendar:read.duplicate')}
          </Button>
        ) : null}
        {canEdit ? (
          <Button size="sm" variant="outline" onClick={onDelete}>
            <Trash2 className="h-4 w-4" /> {t('common:actions.delete')}
          </Button>
        ) : null}
        <ResponsiveMenu>
          <DropdownMenuTrigger className="ml-auto inline-flex h-control-sm w-control-sm items-center justify-center rounded-md hover:bg-accent">
            <MoreHorizontal className="h-4 w-4" aria-label={t('common:actions.more')} />
          </DropdownMenuTrigger>
          <ResponsiveMenuContent title={occ.title}>
            {canShare ? (
              <DropdownMenuItem onClick={onShare}>
                <MessageSquareShare className="h-4 w-4" /> {t('messages:share.action')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onClick={onCopyLink}>
              <Link2 className="h-4 w-4" /> {t('calendar:read.copyLink')}
            </DropdownMenuItem>
          </ResponsiveMenuContent>
        </ResponsiveMenu>
      </div>
    </div>
  )
}
