import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CircleStop, Play, Reply } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { ListSkeleton, Skeleton } from '@/shared/components/ui/skeleton'
import { RowActions } from '@/shared/components/ui/row-actions'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import type { EmailSequence, EmailSequenceEnrollment, EmailSequenceEnrollmentStatus, SequenceStats } from '@/shared/lib/types'
import { StatePill, type StateTone } from '@/shared/components/ui/state-pill'
import { intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'

const STATUS_LABEL: Record<EmailSequenceEnrollmentStatus, string> = {
  active: t('common:states.active'),
  replied: t('email:enrollments.replied'),
  unsubscribed: t('email:enrollments.stopped'),
  completed: t('email:enrollments.completed'),
  failed: t('email:status.failed'),
}
const STATUS_TONE: Record<EmailSequenceEnrollmentStatus, StateTone> = {
  active: 'neutral',
  replied: 'success',
  unsubscribed: 'warning',
  completed: 'neutral',
  failed: 'critical',
}

interface SequenceEnrollmentsDialogProps {
  sequence: EmailSequence | null
  onOpenChange: (open: boolean) => void
}

// Bare orizontale simple per pas — atât de puține date (câțiva pași, zeci de înrolări) nu
// justifică un chart Recharts nou, doar zgomot vizual.
function StepBar({ label, count, total }: { label: string; count: number; total: number }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-16 shrink-0 text-right tnum text-muted-foreground">
        {count} ({pct}%)
      </span>
    </div>
  )
}

function StatsPanel({ sequenceId }: { sequenceId: string }) {
  const stats = useQuery({
    queryKey: ['email', 'sequences', sequenceId, 'stats'],
    queryFn: () => api.get<SequenceStats>(`/api/email/sequences/${sequenceId}/stats`),
  })

  if (stats.isPending) return <Skeleton className="h-16 w-full" />
  const data = stats.data
  if (!data || data.total === 0) return null

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex flex-wrap gap-1.5">
        {(Object.entries(data.byStatus) as [EmailSequenceEnrollmentStatus, number][])
          .filter(([, count]) => count > 0)
          .map(([status, count]) => (
            <StatePill key={status} tone={STATUS_TONE[status]}>
              {STATUS_LABEL[status]}: {count}
            </StatePill>
          ))}
      </div>
      <div className="space-y-1.5">
        {data.byStep.map((step) => (
          <StepBar key={step.step} label={step.label} count={step.count} total={data.total} />
        ))}
      </div>
    </div>
  )
}

export function SequenceEnrollmentsDialog({ sequence, onOpenChange }: SequenceEnrollmentsDialogProps) {
  const queryClient = useQueryClient()

  const enrollments = useQuery({
    queryKey: ['email', 'sequences', sequence?.id, 'enrollments'],
    queryFn: () => api.get<EmailSequenceEnrollment[]>(`/api/email/sequences/${sequence!.id}/enrollments`),
    enabled: Boolean(sequence),
  })

  const stop = useMutation({
    mutationFn: (enrollmentId: string) => api.patch(`/api/email/sequences/${sequence!.id}/enrollments/${enrollmentId}`, { status: 'unsubscribed' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'sequences', sequence?.id, 'enrollments'] })
      toast.success(t('email:enrollments.stoppedToast'))
    },
    onError: (err) => toast.error(err.message),
  })

  // Backstop pt. euristica de reply — dacă un enrollment a fost oprit greșit (ex: matching pe
  // domeniu public, fixat 2026-09-03), Stefan îl poate reporni manual din UI, nu doar din DB.
  const reactivate = useMutation({
    mutationFn: (enrollmentId: string) => api.patch(`/api/email/sequences/${sequence!.id}/enrollments/${enrollmentId}`, { status: 'active' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'sequences', sequence?.id, 'enrollments'] })
      toast.success(t('email:enrollments.resumedToast'))
    },
    onError: (err) => toast.error(err.message),
  })

  // Backstop invers — un răspuns real care n-a trecut prin hook-ul automat de reply (caz real,
  // 2026-09-03: un contact a răspuns la outreach, dar rămăsese 'active').
  const markReplied = useMutation({
    mutationFn: (enrollmentId: string) => api.patch(`/api/email/sequences/${sequence!.id}/enrollments/${enrollmentId}`, { status: 'replied' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'sequences', sequence?.id, 'enrollments'] })
      toast.success(t('email:enrollments.markedReplied'))
    },
    onError: (err) => toast.error(err.message),
  })

  if (!sequence) return null

  return (
    <Dialog open={Boolean(sequence)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('email:enrollments.title', { name: sequence.name })}</DialogTitle>
        </DialogHeader>
        <StatsPanel sequenceId={sequence.id} />
        {enrollments.isPending ? (
          <ListSkeleton rows={4} />
        ) : !enrollments.data?.length ? (
          <p className="text-sm text-muted-foreground">{t('email:enrollments.empty')}</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('common:labels.recipient')}</TableHead>
                  <TableHead>{t('common:labels.status')}</TableHead>
                  <TableHead priority="md">{t('email:enrollments.step')}</TableHead>
                  <TableHead priority="md">{t('email:enrollments.nextSend')}</TableHead>
                  <TableHead className="text-right"><span className="tbl-narrow-sr">{t('common:labels.actions')}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrollments.data.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="w-full max-w-0">
                      <div className="truncate">{e.recipientEmail}</div>
                      {e.recipientName ? <div className="truncate text-xs text-muted-foreground">{e.recipientName}</div> : null}
                      <TableDetails items={[`${e.currentStep} / ${sequence.steps.length}`, e.status === 'active' ? new Date(e.nextSendAt).toLocaleDateString(intlTag()) : null]} />
                    </TableCell>
                    <TableCell>
                      <StatePill tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</StatePill>
                    </TableCell>
                    <TableCell priority="md" className="whitespace-nowrap">
                      {e.currentStep} / {sequence.steps.length}
                    </TableCell>
                    <TableCell priority="md" className="whitespace-nowrap text-xs text-muted-foreground">
                      {e.status === 'active' ? new Date(e.nextSendAt).toLocaleDateString(intlTag()) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <RowActions
                        actions={
                          e.status === 'active'
                            ? [
                                { key: 'replied', icon: Reply, label: t('email:enrollments.replied'), disabled: markReplied.isPending, onClick: () => markReplied.mutate(e.id) },
                                { key: 'stop', icon: CircleStop, label: t('common:actions.stop'), disabled: stop.isPending, onClick: () => stop.mutate(e.id) },
                              ]
                            : e.status === 'replied' || e.status === 'unsubscribed'
                              ? [{ key: 'resume', icon: Play, label: t('email:enrollments.resume'), disabled: reactivate.isPending, onClick: () => reactivate.mutate(e.id) }]
                              : []
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
