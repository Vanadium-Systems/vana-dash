import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import type { EmailSequence, EmailSequenceEnrollment, EmailSequenceEnrollmentStatus, SequenceStats } from '@/shared/lib/types'
import { StatePill, type StateTone } from '@/shared/components/ui/state-pill'
import { intlTag } from '@/shared/lib/format'

const STATUS_LABEL: Record<EmailSequenceEnrollmentStatus, string> = {
  active: 'Activ',
  replied: 'A răspuns',
  unsubscribed: 'Oprit',
  completed: 'Completat',
  failed: 'Eșuat',
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
      toast.success('Înrolare oprită')
    },
    onError: (err) => toast.error(err.message),
  })

  // Backstop pt. euristica de reply — dacă un enrollment a fost oprit greșit (ex: matching pe
  // domeniu public, fixat 2026-09-03), Stefan îl poate reporni manual din UI, nu doar din DB.
  const reactivate = useMutation({
    mutationFn: (enrollmentId: string) => api.patch(`/api/email/sequences/${sequence!.id}/enrollments/${enrollmentId}`, { status: 'active' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'sequences', sequence?.id, 'enrollments'] })
      toast.success('Înrolare reactivată')
    },
    onError: (err) => toast.error(err.message),
  })

  // Backstop invers — un răspuns real care n-a trecut prin hook-ul automat de reply (caz real,
  // 2026-09-03: un contact a răspuns la outreach, dar rămăsese 'active').
  const markReplied = useMutation({
    mutationFn: (enrollmentId: string) => api.patch(`/api/email/sequences/${sequence!.id}/enrollments/${enrollmentId}`, { status: 'replied' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'sequences', sequence?.id, 'enrollments'] })
      toast.success('Marcat ca „a răspuns"')
    },
    onError: (err) => toast.error(err.message),
  })

  if (!sequence) return null

  return (
    <Dialog open={Boolean(sequence)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Înrolări — „{sequence.name}"</DialogTitle>
        </DialogHeader>
        <StatsPanel sequenceId={sequence.id} />
        {enrollments.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : !enrollments.data?.length ? (
          <p className="text-sm text-muted-foreground">Nicio înrolare încă — adaugă destinatari din Prospectare („Adaugă în secvență").</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Destinatar</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Pas</TableHead>
                  <TableHead>Următoarea trimitere</TableHead>
                  <TableHead className="text-right">Acțiuni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {enrollments.data.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <div>{e.recipientEmail}</div>
                      {e.recipientName ? <div className="text-xs text-muted-foreground">{e.recipientName}</div> : null}
                    </TableCell>
                    <TableCell>
                      <StatePill tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</StatePill>
                    </TableCell>
                    <TableCell>
                      {e.currentStep} / {sequence.steps.length}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {e.status === 'active' ? new Date(e.nextSendAt).toLocaleDateString(intlTag()) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {e.status === 'active' ? (
                        <div className="flex justify-end gap-1.5">
                          <Button variant="outline" disabled={markReplied.isPending} onClick={() => markReplied.mutate(e.id)}>
                            A răspuns
                          </Button>
                          <Button variant="outline" disabled={stop.isPending} onClick={() => stop.mutate(e.id)}>
                            Oprește
                          </Button>
                        </div>
                      ) : e.status === 'replied' || e.status === 'unsubscribed' ? (
                        <Button variant="outline" disabled={reactivate.isPending} onClick={() => reactivate.mutate(e.id)}>
                          Reactivează
                        </Button>
                      ) : null}
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
