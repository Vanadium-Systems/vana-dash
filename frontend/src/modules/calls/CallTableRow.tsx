import { Link, PhoneOff } from 'lucide-react'
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

  return (
    <TableRow className="group">
      <TableCell className="font-medium tbl-fill">
        <div className="truncate">{call.title}</div>
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
      <TableCell priority="md" className="max-w-[12rem] truncate">
        {call.prospect?.name ?? call.billingClient?.name ?? (call.bookingId ? t('calls:booking') : '–')}
      </TableCell>
      <TableCell priority="md">
        <StatePill tone={call.status === 'open' ? 'success' : 'neutral'}>
          {t(`calls:status.${call.status}`)}
        </StatePill>
      </TableCell>
      <TableCell className="text-right">
        {call.status === 'open' && can('apeluri.manage') && (
          <div className="flex items-center justify-end gap-1">
            <div className="[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
              <RowActions
                actions={[
                  { key: 'copy', icon: Link, label: t('calls:actions.copyLink'), onClick: () => void copyCallLink(call) },
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
