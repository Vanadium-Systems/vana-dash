import { useEffect, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { t } from '@/shared/lib/i18n'
import type { NewViewInput } from './use-view-actions'

export function SaveViewDialog({ open, onOpenChange, pending, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; pending: boolean; onSave: (input: NewViewInput) => void }) {
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const [notifyNew, setNotifyNew] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setShared(false)
      setNotifyNew(false)
      setError(null)
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('clients:prospects.views.saveTitle')}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return setError(t('clients:prospects.views.nameRequired'))
            onSave({ name: name.trim(), shared, notifyNew })
          }}
        >
          <Field label={t('clients:prospects.views.name')} error={error}>
            <Input autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={shared} onChange={(e) => setShared(e.target.checked)} /> {t('clients:prospects.views.shareWithTeam')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={notifyNew} onChange={(e) => setNotifyNew(e.target.checked)} /> {t('clients:prospects.views.notifyNew')}
          </label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {t('common:actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
