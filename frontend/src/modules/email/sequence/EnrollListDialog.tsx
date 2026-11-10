import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Label } from '@/shared/components/ui/label'
import { Select } from '@/shared/components/ui/select'
import { toast } from 'sonner'
import { useLists } from '@/modules/clients/lists/use-lists-data'
import type { ListEntry } from '@/modules/clients/lists/types'
import { api } from '@/shared/lib/api'
import { formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { EmailSequence, EnrollResult, EnrollSkipReason } from '@/shared/lib/types'

interface EnrollListDialogProps {
  open: boolean
  /** Set when opened from a sequence; the list is chosen. */
  sequence?: EmailSequence
  /** Set when opened from the Lists tab; the sequence is chosen. */
  list?: ListEntry
  onOpenChange: (open: boolean) => void
}

const REASON_LABEL = {
  SUPPRESSED: () => t('email:sequences.enrollList.reasons.SUPPRESSED'),
  BOUNCED: () => t('email:sequences.enrollList.reasons.BOUNCED'),
  UNSUBSCRIBED: () => t('email:sequences.enrollList.reasons.UNSUBSCRIBED'),
  DO_NOT_CONTACT: () => t('email:sequences.enrollList.reasons.DO_NOT_CONTACT'),
  NO_PHONE: () => t('email:sequences.enrollList.reasons.NO_PHONE'),
  NO_EMAIL: () => t('email:sequences.enrollList.reasons.NO_EMAIL'),
  ALREADY_ENROLLED: () => t('email:sequences.enrollList.reasons.ALREADY_ENROLLED'),
} satisfies Record<EnrollSkipReason, () => string>

function skippedSummary(result: EnrollResult): string {
  const counts = new Map<EnrollSkipReason, number>()
  for (const skip of result.skipped ?? []) counts.set(skip.reason, (counts.get(skip.reason) ?? 0) + 1)
  return [...counts].map(([reason, n]) => `${formatNumber(n)} ${REASON_LABEL[reason]()}`).join(', ')
}

export function EnrollListDialog({ open, sequence, list, onOpenChange }: EnrollListDialogProps) {
  const queryClient = useQueryClient()
  const [sequenceId, setSequenceId] = useState(sequence?.id ?? '')
  const [listId, setListId] = useState(list?.id ?? '')
  const [result, setResult] = useState<EnrollResult | null>(null)

  const lists = useLists()
  const sequences = useQuery({
    queryKey: ['email', 'sequences'],
    queryFn: () => api.get<EmailSequence[]>('/api/email/sequences'),
    enabled: open && !sequence,
  })
  const pickable = (sequences.data ?? []).filter((s) => s.active && !s.pausedAt)
  const chosenList = list ?? lists.data?.find((entry) => entry.id === listId)

  const enroll = useMutation({
    mutationFn: () => api.post<EnrollResult>(`/api/email/sequences/${sequenceId}/enroll`, { listId }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'sequences'] })
      void queryClient.invalidateQueries({ queryKey: ['prospects'] })
      setResult(data)
    },
    onError: (err) => toast.error(err.message),
  })

  const close = (next: boolean) => {
    if (!next) setResult(null)
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-density="comfortable">
        <DialogHeader>
          <DialogTitle>{t('email:sequences.enrollList.title')}</DialogTitle>
        </DialogHeader>
        {result ? (
          <div className="space-y-3">
            <p className="text-sm">{t('email:sequences.enrollList.done', { count: result.enrolled, n: formatNumber(result.enrolled) })}</p>
            {skippedSummary(result) ? <p className="text-sm text-muted-foreground">{t('email:sequences.enrollList.skipped', { list: skippedSummary(result) })}</p> : null}
            <Button type="button" className="w-full" onClick={() => close(false)}>
              {t('common:actions.close')}
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              enroll.mutate()
            }}
          >
            {sequence ? null : (
              <div className="space-y-1">
                <Label htmlFor="enroll-seq">{t('pricing:sequence.label')}</Label>
                <Select id="enroll-seq" value={sequenceId} onValueChange={setSequenceId}>
                  <option value="">{t('pricing:sequence.pick')}</option>
                  {pickable.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                {!sequences.isPending && pickable.length === 0 ? <p className="text-xs text-muted-foreground">{t('pricing:sequence.noneActive')}</p> : null}
              </div>
            )}
            {list ? (
              <p className="text-sm">{t('email:sequences.enrollList.fromList', { name: list.name })}</p>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="enroll-list">{t('email:sequences.enrollList.list')}</Label>
                <Select id="enroll-list" value={listId} onValueChange={setListId}>
                  <option value="">{t('email:sequences.enrollList.pickList')}</option>
                  {(lists.data ?? []).map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {chosenList ? <p className="text-xs text-muted-foreground">{t('email:sequences.enrollList.members', { count: chosenList.memberCount, n: formatNumber(chosenList.memberCount) })}</p> : null}
            <p className="text-xs text-muted-foreground">{t('email:sequences.enrollList.rulesHint')}</p>
            <Button type="submit" className="w-full" disabled={!sequenceId || !listId || enroll.isPending}>
              {enroll.isPending ? t('pricing:sequence.enrolling') : t('email:sequences.enrollList.submit')}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
