import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import type { EmailSequence } from '@/shared/lib/types'
import { SequenceEnrollmentsDialog } from './SequenceEnrollmentsDialog'
import { SequenceFormDialog } from './SequenceFormDialog'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { t } from '@/shared/lib/i18n'

const FROM_LABEL: Record<string, string> = {
  contact: t('email:identity.contact'),
  stefan: t('email:identity.stefanPersonal'),
  outreach: t('email:identity.outreach'),
}

export function SequencesTab() {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<EmailSequence | null>(null)
  const [viewingEnrollments, setViewingEnrollments] = useState<EmailSequence | null>(null)

  const sequences = useQuery({
    queryKey: ['email', 'sequences'],
    queryFn: () => api.get<EmailSequence[]>('/api/email/sequences'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/email/sequences/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'sequences'] })
      toast.success(t('email:sequences.deleted'))
    },
    onError: (err) => toast.error(err.message),
  })

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/api/email/sequences/${id}`, { active }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['email', 'sequences'] }),
    onError: (err) => toast.error(err.message),
  })

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <Plus className="h-4 w-4" /> {t('email:sequences.new')}
        </Button>
      </div>
      <Card>
        <CardContent className="pt-6">
          {sequences.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : sequences.isError ? (
            <p className="text-sm text-destructive">{t('email:sequences.loadFailed')}</p>
          ) : !sequences.data?.length ? (
            <p className="text-sm text-muted-foreground">{t('email:sequences.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common:labels.name')}</TableHead>
                  <TableHead>{t('common:labels.from')}</TableHead>
                  <TableHead>{t('email:sequences.steps')}</TableHead>
                  <TableHead>{t('common:labels.state')}</TableHead>
                  <TableHead className="text-right">{t('common:labels.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sequences.data.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      <button type="button" className="underline decoration-dotted underline-offset-2" onClick={() => setViewingEnrollments(s)}>
                        {s.name}
                      </button>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{FROM_LABEL[s.fromIdentity] ?? s.fromIdentity}</TableCell>
                    <TableCell>{s.steps.length}</TableCell>
                    <TableCell>
                      <button type="button" onClick={() => toggleActive.mutate({ id: s.id, active: !s.active })}>
                        <StatePill tone={s.active ? 'success' : 'neutral'}>
                          {s.active ? t('common:states.activeF') : t('email:sequences.paused')}
                        </StatePill>
                      </button>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          onClick={() => {
                            setEditing(s)
                            setDialogOpen(true)
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            void confirm({ title: t('email:sequences.deleteTitle', { name: s.name }), consequence: t('email:sequences.deleteBody'), confirmLabel: t('email:sequences.deleteConfirm'), destructive: true }).then((ok) => ok && remove.mutate(s.id))
                          }}
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
      <SequenceFormDialog open={dialogOpen} onOpenChange={setDialogOpen} sequence={editing} />
      <SequenceEnrollmentsDialog sequence={viewingEnrollments} onOpenChange={(open) => !open && setViewingEnrollments(null)} />
    </div>
  )
}
