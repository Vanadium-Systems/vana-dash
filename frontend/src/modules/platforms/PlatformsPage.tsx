import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/shared/components/PageHeader'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { RowActions } from '@/shared/components/ui/row-actions'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { PlatformStatusBadge } from '@/shared/components/PlatformStatusBadge'
import { api } from '@/shared/lib/api'
import type { Platform, SyncLogEntry } from '@/shared/lib/types'
import { PlatformFormDialog } from './PlatformFormDialog'
import { PlatformOpsSignalsDialog } from './PlatformOpsSignalsDialog'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { formatDateTime, intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'

export function PlatformsPage() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Platform | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [opsSignalsPlatform, setOpsSignalsPlatform] = useState<Platform | null>(null)

  const platforms = useQuery({
    queryKey: ['platforms'],
    queryFn: () => api.get<Platform[]>('/api/platforms'),
  })

  const syncLog = useQuery({
    queryKey: ['platforms', selectedId, 'sync-log'],
    queryFn: () => api.get<SyncLogEntry[]>(`/api/platforms/${selectedId}/sync-log`),
    enabled: Boolean(selectedId),
  })

  const syncNow = useMutation({
    mutationFn: (id: string) => api.post<SyncLogEntry[]>(`/api/platforms/${id}/sync`),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: ['platforms'] })
      void queryClient.invalidateQueries({ queryKey: ['metrics'] })
      setSelectedId(id)
      toast.success(t('platforms:syncDone'))
    },
    onError: (err) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/platforms/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platforms'] })
      toast.success(t('platforms:deleted'))
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('common:nav.platforms')}
        actions={
          <Button
            onClick={() => {
              setEditing(null)
              setDialogOpen(true)
            }}
          >
            <Plus className="h-4 w-4" /> {t('platforms:add')}
          </Button>
        }
      />

      <Card>
        <CardContent className="pt-6">
          {platforms.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : !platforms.data?.length ? (
            <p className="text-sm text-muted-foreground">{t('platforms:empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common:labels.name')}</TableHead>
                  <TableHead priority="md">{t('common:labels.type')}</TableHead>
                  <TableHead>{t('common:labels.status')}</TableHead>
                  <TableHead priority="lg">{t('platforms:labels.syncCron')}</TableHead>
                  <TableHead priority="md">{t('platforms:labels.lastSync')}</TableHead>
                  <TableHead className="text-right"><span className="tbl-narrow-sr">{t('common:labels.actions')}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {platforms.data.map((p) => (
                  <TableRow
                    key={p.id}
                    className={selectedId === p.id ? 'bg-muted/50' : 'cursor-pointer'}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <TableCell truncate className="font-medium">
                      {p.name}
                      <TableDetails items={[p.type, p.lastSyncAt ? formatDateTime(p.lastSyncAt) : null]} />
                    </TableCell>
                    <TableCell priority="md">{p.type}</TableCell>
                    <TableCell>
                      <PlatformStatusBadge status={p.healthStatus} />
                    </TableCell>
                    <TableCell priority="lg" className="whitespace-nowrap font-mono text-xs">{p.syncCron}</TableCell>
                    <TableCell priority="md" className="whitespace-nowrap">{p.lastSyncAt ? formatDateTime(p.lastSyncAt) : '—'}</TableCell>
                    <TableCell className="text-right">
                      <RowActions
                        actions={[
                          { key: 'sync', icon: RefreshCw, label: t('platforms:syncNow'), disabled: syncNow.isPending, spinning: syncNow.isPending, onClick: () => syncNow.mutate(p.id) },
                          { key: 'health', icon: Activity, label: t('platforms:health'), onClick: () => setOpsSignalsPlatform(p) },
                          {
                            key: 'edit',
                            icon: Pencil,
                            label: t('common:actions.edit'),
                            onClick: () => {
                              setEditing(p)
                              setDialogOpen(true)
                            },
                          },
                          {
                            key: 'delete',
                            icon: Trash2,
                            label: t('common:actions.delete'),
                            destructive: true,
                            onClick: () => {
                              void confirm({ title: t('platforms:deleteTitle', { name: p.name }), consequence: t('platforms:deleteBody'), confirmLabel: t('platforms:deleteConfirm'), destructive: true }).then((ok) => ok && remove.mutate(p.id))
                            },
                          },
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {selectedId ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('platforms:log.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            {syncLog.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : !syncLog.data?.length ? (
              <p className="text-sm text-muted-foreground">{t('platforms:log.empty')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('common:labels.status')}</TableHead>
                    <TableHead priority="md">{t('platforms:log.records')}</TableHead>
                    <TableHead>{t('platforms:log.started')}</TableHead>
                    <TableHead priority="lg">{t('platforms:log.finished')}</TableHead>
                    <TableHead priority="md">{t('platforms:log.error')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {syncLog.data.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell>
                        <span
                          className={
                            entry.status === 'SUCCESS'
                              ? 'font-medium text-success'
                              : entry.status === 'FAILED'
                                ? 'font-medium text-destructive'
                                : 'animate-pulse text-muted-foreground'
                          }
                        >
                          {entry.status}
                        </span>
                        <TableDetails items={[String(entry.recordsSync)]} />
                      </TableCell>
                      <TableCell priority="md">{entry.recordsSync}</TableCell>
                      <TableCell className="whitespace-nowrap">{new Date(entry.startedAt).toLocaleString(intlTag())}</TableCell>
                      <TableCell priority="lg" className="whitespace-nowrap">{entry.finishedAt ? new Date(entry.finishedAt).toLocaleString(intlTag()) : '—'}</TableCell>
                      <TableCell priority="md" className="max-w-md truncate text-xs text-muted-foreground" title={entry.errorMessage ?? ''}>
                        {entry.errorMessage ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : null}

      <PlatformFormDialog open={dialogOpen} onOpenChange={setDialogOpen} platform={editing} />
      <PlatformOpsSignalsDialog platform={opsSignalsPlatform} onOpenChange={(open) => !open && setOpsSignalsPlatform(null)} />
    </div>
  )
}
