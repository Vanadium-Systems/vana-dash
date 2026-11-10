import { useEffect, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Textarea } from '@/shared/components/ui/textarea'
import { t } from '@/shared/lib/i18n'

/** A status of kind "lost" needs the reason; the person who picked it types it here. */
export function LostReasonDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setReason('')
      setError(null)
    }
  }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('clients:prospects.lost.title')}</DialogTitle>
          <DialogDescription>{t('clients:prospects.lost.description')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!reason.trim()) return setError(t('clients:prospects.lost.required'))
            onConfirm(reason.trim())
          }}
        >
          <Field label={t('clients:prospects.lost.reason')} error={error}>
            <Textarea autoFocus rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit">{t('clients:prospects.lost.confirm')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
