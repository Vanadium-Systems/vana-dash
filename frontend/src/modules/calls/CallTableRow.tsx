import { Link, Phone, PhoneOff, Video } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/shared/components/ui/button'
import { StatePill } from '@/shared/components/ui/state-pill'
import { RowActions } from '@/shared/components/ui/row-actions'
import { TableCell, TableDetails, TableRow } from '@/shared/components/ui/table'
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
  const canJoin = call.conversationId ? can('mesaje.view') : can('apeluri.manage')
  const KindIcon = call.kind === 'audio' ? Phone : Video

  return (
    <TableRow className="group">
      <TableCell className="font-medium tbl-fill">
        <div className="flex min-w-0 items-center gap-2">
          <KindIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{call.title}</span>
        </div>
        <TableDetails
          items={[
            call.scheduledAt ? formatDateTime(call.scheduledAt) : t('calls:adHoc'),
            <StatePill key="status" tone={call.status === 'open' ? 'success' : 'neutral'}>
              {t(`calls:status.${call.status}`)}
            </StatePill>,
          ]}
        />
      </TableCell>
      <TableCell priority="md" className="whitespace-nowrap text-muted-foreground">
        {call.scheduledAt ? formatDateTime(call.scheduledAt) : t('calls:adHoc')}
      </TableCell>
      <TableCell priority="lg" className="text-right tabular-nums">
        {call.durationSeconds === null
          ? '–'
          : t('calls:minutes', { count: Math.round(call.durationSeconds / 60) })}
      </TableCell>
      <TableCell priority="lg" className="text-right tabular-nums">{call.participantCount ?? '–'}</TableCell>
      <TableCell priority="md" className="max-w-48 truncate">
        {call.prospect?.name ?? call.billingClient?.name ?? (call.bookingId ? t('calls:booking') : '–')}
      </TableCell>
      <TableCell priority="md">
        <StatePill tone={call.status === 'open' ? 'success' : 'neutral'}>
          {t(`calls:status.${call.status}`)}
        </StatePill>
      </TableCell>
      <TableCell className="text-right">
        {call.status === 'open' && canJoin && (
          <div className="flex items-center justify-end gap-1">
            <div className="[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
              <RowActions
                actions={[
                  ...(!call.conversationId
                    ? [{ key: 'copy', icon: Link, label: t('calls:actions.copyLink'), onClick: () => void copyCallLink(call) }]
                    : []),
                  { key: 'end', icon: PhoneOff, label: t('calls:actions.end'), onClick: () => void endCall(call) },
                ]}
              />
            </div>
            <Button size="sm" onClick={() => navigate(`/calls/${call.id}`)}>{t('calls:actions.join')}</Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  )
}
