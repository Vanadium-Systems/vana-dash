import { CalendarClock } from 'lucide-react'
import { useState } from 'react'
import { CompleteTaskDialog } from '../tasks/CompleteTaskDialog'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { useMe } from '@/shared/hooks/use-me'
import { formatDateTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'
import type { ProspectSheet } from './types'

/** The open task due first: tick it off, or, with none, the one warm band of the sheet that asks for one. */
export function NextStep({ sheet, onSchedule }: { sheet: ProspectSheet; onSchedule: () => void }) {
  const { session } = useMe()
  const [completing, setCompleting] = useState(false)
  const task = sheet.nextTask
  if (!task) {
    return (
      <Alert
        tone="warning"
        title={t('clients:sheet.next.none')}
        action={
          sheet.canEdit ? (
            <Button type="button" size="sm" variant="outline" onClick={onSchedule}>
              <CalendarClock aria-hidden="true" /> {t('clients:sheet.next.schedule')}
            </Button>
          ) : null
        }
      />
    )
  }
  const overdue = new Date(task.dueAt).getTime() < Date.now()
  const canTick = sheet.canEdit || task.assigneeUserId === session?.user.id
  return (
    <div className="flex items-center gap-3 rounded-md bg-muted/50 px-3 py-2">
      <CompleteTaskDialog
        task={completing ? { id: task.id, kind: task.kind, title: task.title, prospectId: sheet.id, prospectName: sheet.name } : null}
        onOpenChange={(open) => !open && setCompleting(false)}
      />
      <Checkbox
        disabled={!canTick}
        aria-label={t('clients:sheet.next.done', { title: task.title })}
        checked={false}
        onChange={() => setCompleting(true)}
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{t('clients:sheet.next.title')}</p>
        <p className="truncate text-sm font-medium">{task.title}</p>
        <p className={cn('truncate text-xs', overdue ? 'text-destructive-text' : 'text-muted-foreground')}>
          {[formatDateTime(task.dueAt), task.assigneeName].filter(Boolean).join(' · ')}
        </p>
      </div>
    </div>
  )
}
