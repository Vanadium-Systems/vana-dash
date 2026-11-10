import { useEffect, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { api } from '@/shared/lib/api'
import { companyTimeZone } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { useSheet, useWrite } from '../sheet/use-sheet'
import { buildCompleteBody, emptyDraft, type CompletionDraft } from './completion'
import { CompletionFields } from './CompletionFields'

export interface CompletableTask {
  id: string
  kind: string
  title: string
  prospectId: string
  prospectName: string
}

/** Closing a task: what came out of it and what happens next, in one step. */
export function CompleteTaskDialog({ task, onOpenChange }: { task: CompletableTask | null; onOpenChange: (open: boolean) => void }) {
  const write = useWrite()
  const isCall = task?.kind === 'call'
  const sheet = useSheet(task?.prospectId ?? '', isCall)
  const phones = (sheet.data?.contactPoints ?? []).filter((point) => point.kind === 'phone' && point.status !== 'invalid')
  const [draft, setDraft] = useState<CompletionDraft>(emptyDraft)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (task) setDraft(emptyDraft())
  }, [task?.id])
  // "Wrong number" with one phone needs no question: that is the one.
  useEffect(() => {
    if (phones.length > 0 && !phones.some((phone) => phone.id === draft.contactPointId)) setDraft((current) => ({ ...current, contactPointId: phones[0]!.id }))
  }, [phones, draft.contactPointId])

  const submit = async () => {
    if (!task) return
    setSaving(true)
    const done = await write(() => api.post(`/api/prospects/tasks/${task.id}/done`, buildCompleteBody(draft, task.prospectName, companyTimeZone())), t('clients:sheet.next.doneToast'))
    setSaving(false)
    if (done !== undefined) onOpenChange(false)
  }

  return (
    <Dialog open={task !== null} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('clients:tasks.completeTitle', { title: task?.title })}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <CompletionFields draft={draft} onChange={setDraft} isCall={isCall} phones={phones} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {t('clients:tasks.complete')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
