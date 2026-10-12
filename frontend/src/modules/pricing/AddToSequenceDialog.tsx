import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Label } from '@/shared/components/ui/label'
import { api } from '@/shared/lib/api'
import type { EmailSequence, EnrollResult, Prospect } from '@/shared/lib/types'
import { Select } from '@/shared/components/ui/select'
import { t } from '@/shared/lib/i18n'

interface AddToSequenceDialogProps {
  prospects: Prospect[]
  onOpenChange: (open: boolean) => void
}

// Ține pas cu EnrollSchema (backend/src/modules/email/sequences-schema.ts).
const MAX_RECIPIENTS = 2000

// Telefon/email pot ține mai multe valori separate prin "/" (vezi ProspectareTab.tsx) — enroll-ul
// tratează fiecare adresă ca destinatar separat (propriul enrollment, propriul fir de follow-up),
// nu doar prima (cerere Stefan, 2026-08-17: "as vrea sa dea la toate").
function splitEmails(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function AddToSequenceDialog({ prospects, onOpenChange }: AddToSequenceDialogProps) {
  const queryClient = useQueryClient()
  const [sequenceId, setSequenceId] = useState('')

  const sequences = useQuery({
    queryKey: ['email', 'sequences'],
    queryFn: () => api.get<EmailSequence[]>('/api/email/sequences'),
    enabled: prospects.length > 0,
  })
  const activeSequences = (sequences.data ?? []).filter((s) => s.active)

  // {{nume}} din template — fallback pe numele firmei dacă nu există persoană de contact
  // (ex. import din registru public, fără nume de contact), gol doar dacă lipsesc amândouă.
  const recipients = prospects.flatMap((p) =>
    splitEmails(p.email).map((email) => ({ email, nume: p.contactName ?? p.name ?? undefined, prospectId: p.id })),
  )
  const withoutEmail = prospects.filter((p) => splitEmails(p.email).length === 0).length

  const enroll = useMutation({
    mutationFn: () =>
      api.post<EnrollResult>(`/api/email/sequences/${sequenceId}/enroll`, { recipients }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['email', 'sequences'] })
      const alreadyNote = data.alreadyEnrolled.length ? t('pricing:sequence.alreadyNote', { count: data.alreadyEnrolled.length }) : ''
      toast.success(t('pricing:sequence.enrolledToast', { enrolled: data.enrolled, alreadyNote }))
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  if (prospects.length === 0) return null

  return (
    <Dialog open={prospects.length > 0} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('pricing:sequence.addProspects', { count: prospects.length })}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            enroll.mutate()
          }}
        >
          {withoutEmail > 0 ? (
            <p className="text-sm text-warning">
              {t('pricing:sequence.withoutEmail', { count: withoutEmail })}
            </p>
          ) : null}
          {recipients.length > MAX_RECIPIENTS ? (
            <p className="text-sm text-destructive">
              {t('pricing:sequence.tooMany', { count: recipients.length, MAX_RECIPIENTS })}
            </p>
          ) : null}
          {recipients.length === 0 ? (
            <p className="text-sm text-destructive">{t('pricing:sequence.noneHasEmail')}</p>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="add-seq-select">{t('pricing:sequence.label')}</Label>
              <Select
                id="add-seq-select"
                value={sequenceId}
                onChange={(e) => setSequenceId(e.target.value)}
                required
              >
                <option value="">{t('pricing:sequence.pick')}</option>
                {activeSequences.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              {!sequences.isPending && activeSequences.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('pricing:sequence.noneActive')}</p>
              ) : null}
            </div>
          )}
          <Button
            type="submit"
            className="w-full"
            disabled={!sequenceId || recipients.length === 0 || recipients.length > MAX_RECIPIENTS || enroll.isPending}
          >
            {enroll.isPending ? t('pricing:sequence.enrolling') : t('pricing:sequence.addRecipients', { count: recipients.length })}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
