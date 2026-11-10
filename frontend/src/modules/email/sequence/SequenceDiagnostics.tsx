import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Alert } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { ListSkeleton } from '@/shared/components/ui/skeleton'
import { Table, TableBody, TableCell, TableDetails, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table'
import { api } from '@/shared/lib/api'
import { formatDate, formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { EmailSequence, SequenceDiagnostics as Diagnostics, SequenceDiagnosticsVariant } from '@/shared/lib/types'
import { parseBounceReason, stepKindLabel } from './steps'

const NUMBER = 'text-right tabular-nums'

/** "B has 4 more replies out of 120": the gap between the variants, in words, only when both sent something. */
function variantGap(variants: SequenceDiagnosticsVariant[]): string | null {
  const a = variants.find((v) => v.variant === 'A')
  const b = variants.find((v) => v.variant === 'B')
  if (!a || !b || a.sent === 0 || b.sent === 0) return null
  if (a.replied === b.replied) return t('email:sequences.diag.noGap')
  const winner = a.replied > b.replied ? a : b
  return t('email:sequences.diag.gap', { variant: winner.variant, diff: formatNumber(Math.abs(a.replied - b.replied)), sent: formatNumber(winner.sent) })
}

function PauseBand({ sequence, paused, rule }: { sequence: EmailSequence; paused: NonNullable<Diagnostics['paused']>; rule: Diagnostics['bouncePause'] }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const bounce = parseBounceReason(paused.reason)
  const resume = useMutation({
    mutationFn: () => api.patch(`/api/email/sequences/${sequence.id}`, { paused: false }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'sequences'] })
      toast.success(t('email:sequences.diag.resumed'))
    },
    onError: (err) => toast.error(err.message),
  })
  return (
    <Alert
      tone="warning"
      title={t('email:sequences.diag.pausedOn', { date: formatDate(paused.at) })}
      action={
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={resume.isPending}
          onClick={() => void confirm({ title: t('email:sequences.diag.resumeTitle', { name: sequence.name }), consequence: t('email:sequences.diag.resumeBody'), confirmLabel: t('email:sequences.diag.resume') }).then((ok) => ok && resume.mutate())}
        >
          {t('email:sequences.diag.resume')}
        </Button>
      }
    >
      {bounce ? t('email:sequences.diag.bounceReason', { percent: formatNumber(Math.round(bounce.rate * 100)), sends: formatNumber(bounce.sends) }) : t('email:sequences.diag.pausedByHand')}{' '}
      {t('email:sequences.diag.bounceRule', { percent: formatNumber(Math.round(rule.threshold * 100)), window: formatNumber(rule.window), min: formatNumber(rule.minSends) })}
    </Alert>
  )
}

export function SequenceDiagnostics({ sequence }: { sequence: EmailSequence }) {
  const diagnostics = useQuery({
    queryKey: ['email', 'sequences', sequence.id, 'diagnostics'],
    queryFn: () => api.get<Diagnostics>(`/api/email/sequences/${sequence.id}/diagnostics`),
  })

  if (diagnostics.isPending) return <ListSkeleton rows={4} />
  if (diagnostics.isError) return <EmptyState kind="filtered" title={t('email:sequences.diag.loadFailed')} onReset={() => void diagnostics.refetch()} />
  const { steps, paused, bouncePause } = diagnostics.data

  return (
    <div className="space-y-3">
      {paused ? <PauseBand sequence={sequence} paused={paused} rule={bouncePause} /> : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('email:sequences.diag.step')}</TableHead>
            <TableHead className={NUMBER}>{t('email:sequences.diag.sent')}</TableHead>
            <TableHead priority="md" className={NUMBER}>{t('email:sequences.diag.opened')}</TableHead>
            <TableHead priority="lg" className={NUMBER}>{t('email:sequences.diag.clicked')}</TableHead>
            <TableHead className={NUMBER}>{t('email:sequences.diag.replied')}</TableHead>
            <TableHead priority="md" className={NUMBER}>{t('email:sequences.diag.bounced')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {steps.map((step) =>
            step.kind === 'email' ? (
              step.variants.map((variant) => (
                <TableRow key={`${step.stepId}-${variant.variant}`}>
                  <TableCell className="tbl-fill">
                    <span className="block truncate">
                      {t('email:sequences.diag.stepEmail', { n: formatNumber(step.order) })}
                      {step.variants.length > 1 ? ` · ${variant.variant}` : ''}
                    </span>
                    <TableDetails items={[t('email:sequences.diag.openedN', { n: formatNumber(variant.opened) }), t('email:sequences.diag.clickedN', { n: formatNumber(variant.clicked) }), t('email:sequences.diag.bouncedN', { n: formatNumber(variant.bounced) })]} />
                  </TableCell>
                  <TableCell className={NUMBER}>{formatNumber(variant.sent)}</TableCell>
                  <TableCell priority="md" className={NUMBER}>{formatNumber(variant.opened)}</TableCell>
                  <TableCell priority="lg" className={NUMBER}>{formatNumber(variant.clicked)}</TableCell>
                  <TableCell className={NUMBER}>{formatNumber(variant.replied)}</TableCell>
                  <TableCell priority="md" className={NUMBER}>{formatNumber(variant.bounced)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow key={step.stepId}>
                <TableCell className="tbl-fill">
                  <span className="block truncate">{t('email:sequences.diag.stepOther', { n: formatNumber(step.order), kind: stepKindLabel(step.kind) })}</span>
                </TableCell>
                <TableCell className="text-muted-foreground" colSpan={5}>
                  {t('email:sequences.diag.reached', { n: formatNumber(step.reached) })}
                </TableCell>
              </TableRow>
            ),
          )}
        </TableBody>
      </Table>
      {steps.map((step) => {
        const gap = step.kind === 'email' ? variantGap(step.variants) : null
        return gap ? (
          <p key={step.stepId} className="text-sm">
            {t('email:sequences.diag.stepEmail', { n: formatNumber(step.order) })}: {gap}
          </p>
        ) : null
      })}
    </div>
  )
}
