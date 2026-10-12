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
      toast.success('Sync rulat — vezi rezultatul în sync log')
    },
    onError: (err) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/platforms/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['platforms'] })
      toast.success('Platformă ștearsă')
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platforme"
        actions={
          <Button
            onClick={() => {
              setEditing(null)
              setDialogOpen(true)
            }}
          >
            <Plus className="h-4 w-4" /> Adaugă platformă
          </Button>
        }
      />

      <Card>
        <CardContent className="pt-6">
          {platforms.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : !platforms.data?.length ? (
            <p className="text-sm text-muted-foreground">Nicio platformă conectată. Adaugă prima cu butonul de sus.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nume</TableHead>
                  <TableHead>Tip</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sync cron</TableHead>
                  <TableHead>Ultimul sync</TableHead>
                  <TableHead className="text-right">Acțiuni</TableHead>
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
                          title="Sync now"
                        >
                          <RefreshCw className={syncNow.isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                        </Button>
                        <Button variant="outline" onClick={() => setOpsSignalsPlatform(p)} title="Sănătate">
                          <Activity className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setEditing(p)
                            setDialogOpen(true)
                          }}
                          title="Editează"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            void confirm({ title: `Șterge platforma „${p.name}”`, consequence: 'Sincronizarea se oprește. Metricile deja colectate rămân.', confirmLabel: 'Șterge platforma', destructive: true }).then((ok) => ok && remove.mutate(p.id))
                          }}
                          title="Șterge"
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
            <CardTitle>Sync log</CardTitle>
          </CardHeader>
          <CardContent>
            {syncLog.isPending ? (
              <Skeleton className="h-24 w-full" />
            ) : !syncLog.data?.length ? (
              <p className="text-sm text-muted-foreground">Niciun sync încă pentru platforma selectată.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Records</TableHead>
                    <TableHead>Început</TableHead>
                    <TableHead>Terminat</TableHead>
                    <TableHead>Eroare</TableHead>
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
