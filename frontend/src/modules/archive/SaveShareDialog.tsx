import { useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import {
  discardSaves,
  getSavesSnapshot,
  removeSaved,
  subscribeSaves,
  uploadSave,
} from '@/shared/lib/share-in'
import { formatBytes } from '@/shared/lib/utils'
import type { PickerCrumb } from './FolderPicker'
import { FolderPicker } from './FolderPicker'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { formatCount } from '@/shared/lib/utils'

// Popup-ul de destinație cerut la share („Share → VanaDash"): listează fișierele primite,
// lasă Stefan să aleagă folderul din Arhivă și urcă doar la confirmare. Dialogul nu se închide
// din exterior (tap în overlay / Esc) ca un share să nu fie aruncat din greșeală — doar
// „Renunță" sau salvarea reușită îl închid.
export function SaveShareDialog() {
  const confirm = useConfirm()
  const saves = useSyncExternalStore(subscribeSaves, getSavesSnapshot)
  const [trail, setTrail] = useState<PickerCrumb[]>([{ id: null, name: 'Arhivă' }])
  const [failedIds, setFailedIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  // Redenumire înainte de salvare (Stefan recunoaște fișierul mai târziu) — doar ce a modificat
  // explicit ține în edits, restul rămân pe numele original.
  const [edits, setEdits] = useState<Record<number, string>>({})

  if (!saves.length) return null

  async function saveAll() {
    setSaving(true)
    setFailedIds([])
    let uploaded = 0
    const failed: number[] = []
    // Snapshot de la randare — removeSaved mută store-ul, dar lista noastră rămâne stabilă.
    for (const save of saves) {
      try {
        await uploadSave(save, trail[trail.length - 1]?.id ?? null, edits[save.id])
        removeSaved([save.id])
        uploaded++
      } catch {
        failed.push(save.id)
      }
    }
    setSaving(false)
    if (failed.length) {
      setFailedIds(failed)
      toast.error(`${failed.length} din ${saves.length} fișiere nu au putut fi salvate`)
    }
    if (uploaded > 0) toast.success(uploaded === 1 ? 'Salvat în Arhivă' : `${uploaded} fișiere salvate în Arhivă`)
  }

  function discard() {
    void confirm({
      title: saves.length === 1 ? 'Renunță la fișierul partajat' : `Renunță la ${formatCount(saves.length, 'fișier partajat', 'fișiere partajate')}`,
      consequence: 'Nu se salvează nimic în Arhivă.',
      confirmLabel: 'Renunță',
      destructive: true,
    }).then((ok) => ok && discardSaves())
  }

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            Salvează în Arhivă ({saves.length} {saves.length === 1 ? 'fișier' : 'fișiere'})
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5 rounded-md border p-2">
          {saves.map((save) => (
            <div key={save.id} className="flex items-center gap-2">
              <Input
                value={edits[save.id] ?? save.name}
                onChange={(e) => setEdits((prev) => ({ ...prev, [save.id]: e.target.value }))}
                className="min-w-0 flex-1"
                aria-label={`Nume fișier: ${save.name}`}
              />
              {failedIds.includes(save.id) ? (
                <span className="shrink-0 text-xs text-destructive">eroare</span>
              ) : (
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatBytes(Math.round((save.base64.length * 3) / 4))}
                </span>
              )}
            </div>
          ))}
        </div>

        <FolderPicker trail={trail} onNavigate={setTrail} />

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={saving} onClick={discard}>
            Renunță
          </Button>
          <Button disabled={saving} onClick={() => void saveAll()}>
            {saving ? 'Se salvează…' : `Salvează aici (${trail[trail.length - 1]?.name ?? 'Arhivă'})`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
