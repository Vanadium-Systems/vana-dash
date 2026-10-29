import { useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { t } from '@/shared/lib/i18n'

interface NameDialogProps {
  title: string
  initialName?: string
  submitLabel: string
  isPending: boolean
  onSubmit: (name: string) => void
  onClose: () => void
}

/** Rename a file or folder, or name a new folder. Mounted only while open, so the field starts fresh. */
export function NameDialog({ title, initialName = '', submitLabel, isPending, onSubmit, onClose }: NameDialogProps) {
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            const trimmed = name.trim()
            if (!trimmed) return setError(t('archive:nameDialog.required'))
            if (trimmed === initialName) return onClose()
            onSubmit(trimmed)
          }}
        >
          <Field label={t('archive:nameDialog.label')} error={error}>
            <Input
              id="archive-name"
              value={name}
              autoFocus
              onFocus={(e) => {
                // Select the name without the extension, as file managers do.
                const dot = e.target.value.lastIndexOf('.')
                e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length)
              }}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={isPending}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
