import { LogOut } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardTitle } from '@/shared/components/ui/card'
import { ConfirmDialog } from '@/shared/components/ui/confirm-dialog'
import { RowActions } from '@/shared/components/ui/row-actions'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { formatDate, formatDateTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { useDevices, useLogoutDevice, useLogoutOtherDevices, useMessageKeys, type SessionDevice } from './devices'

// Where the person is logged in, in "Profilul meu". Every row is one login family (one device).

function deviceName(device: SessionDevice): string {
  return device.deviceLabel ?? t('auth:devices.unknown')
}

/** Whether this login can read encrypted messages, with the start of its key to compare. */
function messageKeyLabel(key: { approved: boolean; fingerprint: string } | undefined): string | null {
  if (!key) return null
  return key.approved
    ? t('auth:devices.messageKeyApproved', { fingerprint: key.fingerprint })
    : t('auth:devices.messageKeyPending', { fingerprint: key.fingerprint })
}

export function DevicesCard() {
  const devices = useDevices()
  const messageKeys = useMessageKeys()
  const logout = useLogoutDevice()
  const logoutOthers = useLogoutOtherDevices()
  const [leaving, setLeaving] = useState<SessionDevice | null>(null)
  const [leavingOthers, setLeavingOthers] = useState(false)

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t('auth:devices.title')}</CardTitle>
          {devices.data && devices.data.length > 1 ? (
            <Button variant="outline" onClick={() => setLeavingOthers(true)}>
              {t('auth:devices.logoutOthers')}
            </Button>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">{t('auth:devices.intro')}</p>

        {devices.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : devices.isError ? (
          <div className="space-y-2 text-sm">
            <p>{t('auth:devices.loadFailed')}</p>
            <Button variant="outline" onClick={() => void devices.refetch()}>
              {t('common:actions.retry')}
            </Button>
          </div>
        ) : (
          <Table>
            <caption className="sr-only">{t('auth:devices.tableCaption')}</caption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('auth:devices.columns.device')}</TableHead>
                <TableHead priority="md">{t('auth:devices.columns.lastActive')}</TableHead>
                <TableHead priority="lg">{t('auth:devices.columns.since')}</TableHead>
                <TableHead className="text-right">
                  <span className="tbl-narrow-sr">{t('common:labels.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.data.map((device) => (
                <TableRow key={device.familyId}>
                  <TableCell className="font-medium tbl-fill">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{deviceName(device)}</span>
                      {device.current ? <Badge variant="secondary">{t('auth:devices.current')}</Badge> : null}
                    </div>
                    <TableDetails
                      items={[
                        formatDateTime(device.lastUsedAt),
                        t('auth:devices.loggedSince', { date: formatDate(device.createdAt) }),
                        device.ip,
                      ]}
                    />
                    {messageKeyLabel(messageKeys.data?.get(device.familyId)) ? (
                      <p className="mt-0.5 truncate text-xs font-normal text-muted-foreground">
                        {messageKeyLabel(messageKeys.data?.get(device.familyId))}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell priority="md" className="whitespace-nowrap">
                    {formatDateTime(device.lastUsedAt)}
                  </TableCell>
                  <TableCell priority="lg" className="whitespace-nowrap">
                    {formatDate(device.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {device.current ? null : (
                      <RowActions
                        title={deviceName(device)}
                        actions={[{ key: 'logout', icon: LogOut, label: t('auth:devices.logout'), destructive: true, onClick: () => setLeaving(device) }]}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <ConfirmDialog
        open={Boolean(leaving)}
        onOpenChange={(open) => !open && setLeaving(null)}
        title={t('auth:devices.logoutDialog.title', { device: leaving ? deviceName(leaving) : '' })}
        consequence={t('auth:devices.logoutDialog.body')}
        confirmLabel={t('auth:devices.logout')}
        destructive
        onConfirm={() => leaving && logout.mutate(leaving.familyId)}
      />
      <ConfirmDialog
        open={leavingOthers}
        onOpenChange={setLeavingOthers}
        title={t('auth:devices.logoutOthersDialog.title')}
        consequence={t('auth:devices.logoutOthersDialog.body')}
        confirmLabel={t('auth:devices.logoutOthers')}
        destructive
        onConfirm={() => logoutOthers.mutate(undefined)}
      />
    </Card>
  )
}
