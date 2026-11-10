import { Link } from 'react-router-dom'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { formatDateTime, formatRelativeTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { useDiscussedIn } from './use-sheet'

/** The conversations of mine where this prospect was shared (MS8). */
export function DiscussedTab({ prospectId }: { prospectId: string }) {
  const discussed = useDiscussedIn(prospectId)
  if (discussed.isPending) return <ListSkeleton rows={2} />
  const rows = discussed.data ?? []
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t('clients:sheet.discussed.empty')}</p>
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((row) => (
        <li key={row.conversationId} className="flex min-w-0 items-baseline justify-between gap-3">
          <Link to={`/messages/${row.conversationId}`} className="min-w-0 truncate underline-offset-2 hover:underline">
            {row.title || t('clients:sheet.discussed.untitled')}
          </Link>
          <span className="shrink-0 text-xs text-muted-foreground" title={formatDateTime(row.lastSharedAt)}>
            {formatRelativeTime(row.lastSharedAt)}
          </span>
        </li>
      ))}
    </ul>
  )
}
