import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { useMe } from '@/shared/hooks/use-me'
import { formatNumber } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { skippedSummary } from './skipped'
import { useListActions, useLists } from './use-lists-data'

const NEW_LIST = '__new'

/** "Adaugă în listă" from the prospect sheet: an existing list, or a new one made on the spot. */
export function AddToListDialog({ open, onOpenChange, prospectIds }: { open: boolean; onOpenChange: (open: boolean) => void; prospectIds: string[] }) {
  const { can } = useMe()
  const canCreate = can('clienti.prospectare')
  const lists = useLists()
  const actions = useListActions()
  const [choice, setChoice] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (open) {
      setChoice('')
      setName('')
      setError(null)
    }
  }, [open])

  const submit = async () => {
    if (!choice) return setError(t('clients:lists.add.required'))
    if (choice === NEW_LIST && !name.trim()) return setError(t('clients:lists.nameRequired'))
    setPending(true)
    try {
      const listId = choice === NEW_LIST ? (await actions.createList.mutateAsync({ name: name.trim(), folderId: null, shared: true })).id : choice
      const result = await actions.addByIds.mutateAsync({ listId, ids: prospectIds })
      const skipped = skippedSummary(result.skipped)
      toast.success(t('clients:prospects.bulk.listAdded', { count: result.added }) + (skipped ? ` ${skipped}` : ''))
      onOpenChange(false)
    } catch {
      // Both mutations already toast their own error.
    } finally {
      setPending(false)
    }
  }

  const options = [
    { value: '', label: t('clients:lists.add.choose') },
    ...(lists.data ?? []).map((list) => ({ value: list.id, label: `${list.name} (${formatNumber(list.memberCount)})` })),
    ...(canCreate ? [{ value: NEW_LIST, label: t('clients:lists.add.newOption') }] : []),
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('clients:prospects.bulk.list')}</DialogTitle>
          <DialogDescription>{t('clients:lists.add.description', { count: prospectIds.length })}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Field label={t('clients:lists.add.list')} error={choice === NEW_LIST ? null : error}>
            <Select value={choice} onValueChange={setChoice} options={options} />
          </Field>
          {choice === NEW_LIST ? (
            <Field label={t('clients:lists.name')} error={error}>
              <Input autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
            </Field>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" disabled={pending}>
              {t('clients:lists.add.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
