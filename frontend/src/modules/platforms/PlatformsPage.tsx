import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/shared/components/PageHeader'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { PlatformStatusBadge } from '@/shared/components/PlatformStatusBadge'
import { api } from '@/shared/lib/api'
import type { Platform, SyncLogEntry } from '@/shared/lib/types'
import { PlatformFormDialog } from './PlatformFormDialog'
import { PlatformOpsSignalsDialog } from './PlatformOpsSignalsDialog'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { intlTag } from '@/shared/lib/format'
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
                  <TableHead>{t('common:labels.type')}</TableHead>
                  <TableHead>{t('common:labels.status')}</TableHead>
                  <TableHead>{t('platforms:labels.syncCron')}</TableHead>
                  <TableHead>{t('platforms:labels.lastSync')}</TableHead>
                  <TableHead className="text-right">{t('common:labels.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {platforms.data.map((p) => (
                  <TableRow
                    key={p.id}
                    className={selectedId === p.id ? 'bg-muted/50' : 'cursor-pointer'}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.type}</TableCell>
                    <TableCell>
                      <PlatformStatusBadge status={p.healthStatus} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{p.syncCron}</TableCell>
                    <TableCell>{p.lastSyncAt ? new Date(p.lastSyncAt).toLocaleString(intlTag()) : '—'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="outline"
                          disabled={syncNow.isPending}
                          onClick={() => syncNow.mutate(p.id)}
                          title={t('platforms:syncNow')}
                        >
                          <RefreshCw className={syncNow.isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                        </Button>
                        <Button variant="outline" onClick={() => setOpsSignalsPlatform(p)} title={t('platforms:health')}>
                          <Activity className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setEditing(p)
                            setDialogOpen(true)
                          }}
                          title={t('common:actions.edit')}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            void confirm({ title: t('platforms:deleteTitle', { name: p.name }), consequence: t('platforms:deleteBody'), confirmLabel: t('platforms:deleteConfirm'), destructive: true }).then((ok) => ok && remove.mutate(p.id))
                          }}
                          title={t('common:actions.delete')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
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
                    <TableHead>{t('platforms:log.records')}</TableHead>
                    <TableHead>{t('platforms:log.started')}</TableHead>
                    <TableHead>{t('platforms:log.finished')}</TableHead>
                    <TableHead>{t('platforms:log.error')}</TableHead>
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
                      </TableCell>
                      <TableCell>{entry.recordsSync}</TableCell>
                      <TableCell>{new Date(entry.startedAt).toLocaleString(intlTag())}</TableCell>
                      <TableCell>{entry.finishedAt ? new Date(entry.finishedAt).toLocaleString(intlTag()) : '—'}</TableCell>
                      <TableCell className="max-w-md truncate text-xs text-muted-foreground" title={entry.errorMessage ?? ''}>
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
