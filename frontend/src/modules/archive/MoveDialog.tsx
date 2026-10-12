import { useState } from 'react'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import type { PickerCrumb } from './FolderPicker'
import { FolderPicker } from './FolderPicker'

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
  const [trail, setTrail] = useState<PickerCrumb[]>([{ id: null, name: 'Arhivă' }])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mută „{itemName}"</DialogTitle>
        </DialogHeader>
        <FolderPicker trail={trail} onNavigate={setTrail} />
        <Button className="w-full" disabled={isPending} onClick={() => onConfirm(trail[trail.length - 1]!.id)}>
          {isPending ? 'Se mută…' : `Mută aici (${trail[trail.length - 1]!.name})`}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
