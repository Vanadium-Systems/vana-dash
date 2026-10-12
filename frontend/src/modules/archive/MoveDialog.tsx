import { useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import type { PickerCrumb } from './FolderPicker'
import { FolderPicker } from './FolderPicker'
import { t } from '@/shared/lib/i18n'

interface MoveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  itemName: string
  onConfirm: (targetFolderId: string | null) => void
  isPending: boolean
}

// Cicluri (mutare folder în propriul descendent) sunt respinse de backend
// (ArchiveConflictError → toast), nu prevenite aici — ar cere precalcularea întregului subarbore
// doar pt. un tool personal, un singur user.
export function MoveDialog({ open, onOpenChange, itemName, onConfirm, isPending }: MoveDialogProps) {
  const [trail, setTrail] = useState<PickerCrumb[]>([{ id: null, name: t('common:nav.archive') }])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('archive:move.title', { itemName })}</DialogTitle>
        </DialogHeader>
        <FolderPicker trail={trail} onNavigate={setTrail} />
        <Button className="w-full" disabled={isPending} onClick={() => onConfirm(trail[trail.length - 1]!.id)}>
          {isPending ? t('archive:move.moving') : t('archive:move.here', { name: trail[trail.length - 1]!.name })}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
