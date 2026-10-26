import { useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { t } from '@/shared/lib/i18n'
import { copyCallLink, useCreateCall } from './calls-api'

// A link left open for a week is a risk nobody wants to audit, so the list stops at a working day.
const HOUR_OPTIONS = [1, 2, 4, 8]

export function NewCallDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [title, setTitle] = useState('')
  const [hours, setHours] = useState('4')
  const [titleError, setTitleError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const create = useCreateCall()

  async function submit() {
    if (!title.trim()) {
      setTitleError(t('calls:dialog.titleRequired'))
      return
    }
    setTitleError(null)

    let call
    try {
      call = await create.mutateAsync({ title: title.trim(), expiresInHours: Number(hours) })
    } catch (err) {
      // The values stay in the form: the user only presses the button again.
      setFormError(err instanceof Error ? err.message : String(err))
      return
    }
    await copyCallLink(call)
    setTitle('')
    setHours('4')
    setTitleError(null)
    setFormError(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="text-base">{t('calls:dialog.title')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <Field label={t('calls:dialog.titleLabel')} error={titleError}>
            <Input
              id="call-title"
              value={title}
              maxLength={120}
              placeholder={t('calls:dialog.titlePlaceholder')}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field label={t('calls:dialog.durationLabel')}>
            <Select
              id="call-hours"
              value={hours}
              onValueChange={setHours}
              size="sm"
              options={HOUR_OPTIONS.map((n) => ({
                value: String(n),
                label: t('calls:dialog.hours', { count: n }),
              }))}
            />
          </Field>
          {formError ? <p className="text-sm text-destructive-text">{formError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('calls:dialog.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {t('calls:dialog.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
