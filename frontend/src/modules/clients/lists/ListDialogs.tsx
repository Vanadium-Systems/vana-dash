import { useEffect, useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Select } from '@/shared/components/ui/select'
import { t } from '@/shared/lib/i18n'
import type { ListEntry, ListFolder } from './types'

const NO_FOLDER = ''

interface FolderValues {
  name: string
  shared: boolean
}
interface ListValues extends FolderValues {
  folderId: string | null
}

/** Create (no `folder`) or rename / re-share a folder. */
export function FolderDialog({ open, folder, pending, onOpenChange, onSave }: { open: boolean; folder: ListFolder | null; pending: boolean; onOpenChange: (open: boolean) => void; onSave: (values: FolderValues) => void }) {
  const [name, setName] = useState('')
  const [shared, setShared] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setName(folder?.name ?? '')
      setShared(folder?.shared ?? true)
      setError(null)
    }
  }, [open, folder])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{folder ? t('clients:lists.folder.editTitle') : t('clients:lists.folder.newTitle')}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return setError(t('clients:lists.nameRequired'))
            onSave({ name: name.trim(), shared })
          }}
        >
          <Field label={t('clients:lists.name')} error={error}>
            <Input autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={shared} onChange={(e) => setShared(e.target.checked)} /> {t('clients:lists.folder.share')}
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

/** Create (no `list`) or edit a list: name, the folder it sits in, who sees it. */
export function ListDialog({
  open,
  list,
  folders,
  defaultFolderId,
  initialName,
  pending,
  onOpenChange,
  onSave,
}: {
  open: boolean
  list: ListEntry | null
  folders: ListFolder[]
  defaultFolderId?: string | null
  initialName?: string
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSave: (values: ListValues) => void
}) {
  const [name, setName] = useState('')
  const [folderId, setFolderId] = useState(NO_FOLDER)
  const [shared, setShared] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setName(list?.name ?? initialName ?? '')
      setFolderId(list?.folderId ?? defaultFolderId ?? NO_FOLDER)
      setShared(list?.shared ?? true)
      setError(null)
    }
  }, [open, list, defaultFolderId, initialName])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{list ? t('clients:lists.editTitle') : t('clients:lists.newTitle')}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return setError(t('clients:lists.nameRequired'))
            onSave({ name: name.trim(), folderId: folderId || null, shared })
          }}
        >
          <Field label={t('clients:lists.name')} error={error}>
            <Input autoFocus value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('clients:lists.folder.label')} optional>
            <Select value={folderId} onValueChange={setFolderId} options={[{ value: NO_FOLDER, label: t('clients:lists.noFolder') }, ...folders.map((f) => ({ value: f.id, label: f.name }))]} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={shared} onChange={(e) => setShared(e.target.checked)} /> {t('clients:lists.share')}
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
