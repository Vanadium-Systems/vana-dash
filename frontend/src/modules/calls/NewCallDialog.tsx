import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { useDebounced } from '@/shared/hooks/use-debounced'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import { copyCallLink, useCreateCall } from './calls-api'

// A link left open for a week is a risk nobody wants to audit, so the list stops at a working day.
const HOUR_OPTIONS = [1, 2, 4, 8]

type LinkedProspect = { id: string; name: string }

/** Finds a prospect by name; the call keeps the link, so the sheet and the call list show each other. */
function ProspectPicker({ id, value, onChange }: { id?: string; value: LinkedProspect | null; onChange: (next: LinkedProspect | null) => void }) {
  const [term, setTerm] = useState('')
  const needle = useDebounced(term.trim(), 250)
  const found = useQuery({
    queryKey: ['calls', 'prospect-search', needle],
    queryFn: () => api.get<{ rows: LinkedProspect[] }>(`/api/prospects?kind=companies&pageSize=6&q=${encodeURIComponent(needle)}`),
    enabled: needle.length >= 2 && value === null,
  })
  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
        <span className="min-w-0 truncate">{value.name}</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
          {t('calls:dialog.unlinkProspect')}
        </Button>
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <Input id={id} type="search" value={term} maxLength={120} onChange={(event) => setTerm(event.target.value)} />
      {(found.data?.rows ?? []).length > 0 ? (
        <ul className="rounded-md border p-1">
          {found.data!.rows.map((row) => (
            <li key={row.id}>
              <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => onChange({ id: row.id, name: row.name })}>
                <span className="truncate">{row.name}</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function NewCallDialog({ open, onOpenChange, prospect: initialProspect }: { open: boolean; onOpenChange: (open: boolean) => void; prospect?: LinkedProspect }) {
  const { can } = useMe()
  const [prospect, setProspect] = useState<LinkedProspect | null>(initialProspect ?? null)
  useEffect(() => {
    if (open) setProspect(initialProspect ?? null)
  }, [open, initialProspect])
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
      call = await create.mutateAsync({ title: title.trim(), expiresInHours: Number(hours), ...(prospect ? { prospectId: prospect.id } : {}) })
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
          {can('clienti.view') ? (
            <Field label={t('calls:dialog.prospectLabel')} optional>
              <ProspectPicker
                value={prospect}
                onChange={(next) => {
                  setProspect(next)
                  // The title follows the prospect only while it is still empty.
                  if (next && !title.trim()) setTitle(t('calls:dialog.titleFor', { name: next.name }))
                }}
              />
            </Field>
          ) : null}
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
