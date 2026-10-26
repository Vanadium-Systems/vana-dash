import { useNavigate } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import { StatePill } from '@/shared/components/ui/state-pill'
import { TableCell, TableRow } from '@/shared/components/ui/table'
import { useMe } from '@/shared/hooks/use-me'
import { formatDateTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { copyCallLink, useEndCall } from './calls-api'
import type { CallRow } from './types'

// Join is always visible, the rest waits for a hover or a keyboard focus: an open call is
// the action, the housekeeping is secondary.
export function CallTableRow({ call }: { call: CallRow }) {
  const navigate = useNavigate()
  const endCall = useEndCall()
  const { can } = useMe()

  return (
    <TableRow className="group">
      <TableCell className="font-medium">{call.title}</TableCell>
      <TableCell className="text-muted-foreground">
        {call.scheduledAt ? formatDateTime(call.scheduledAt) : t('calls:adHoc')}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {call.durationSeconds === null
          ? '–'
          : t('calls:minutes', { count: Math.round(call.durationSeconds / 60) })}
      </TableCell>
      <TableCell className="text-right tabular-nums">{call.participantCount ?? '–'}</TableCell>
      <TableCell>
        {call.prospect?.name ?? call.billingClient?.name ?? (call.bookingId ? t('calls:booking') : '–')}
      </TableCell>
      <TableCell>
        <StatePill tone={call.status === 'open' ? 'success' : 'neutral'}>
          {t(`calls:status.${call.status}`)}
        </StatePill>
      </TableCell>
      <TableCell className="text-right">
        {call.status === 'open' && can('apeluri.manage') && (
          <div className="flex items-center justify-end gap-1">
            <div className="flex gap-1 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
              <Button variant="ghost" size="sm" onClick={() => void copyCallLink(call)}>
                {t('calls:actions.copyLink')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void endCall(call)}>
                {t('calls:actions.end')}
              </Button>
            </div>
            <Button size="sm" onClick={() => navigate(`/calls/${call.id}`)}>{t('calls:actions.join')}</Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  )
}
