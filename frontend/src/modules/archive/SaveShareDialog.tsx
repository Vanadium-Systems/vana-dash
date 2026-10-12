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
import { t } from '@/shared/lib/i18n'

// Popup-ul de destinație cerut la share („Share → VanaDash"): listează fișierele primite,
// lasă Stefan să aleagă folderul din Arhivă și urcă doar la confirmare. Dialogul nu se închide
// din exterior (tap în overlay / Esc) ca un share să nu fie aruncat din greșeală — doar
// „Renunță" sau salvarea reușită îl închid.
export function SaveShareDialog() {
  const confirm = useConfirm()
  const saves = useSyncExternalStore(subscribeSaves, getSavesSnapshot)
  const [trail, setTrail] = useState<PickerCrumb[]>([{ id: null, name: t('common:nav.archive') }])
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
      toast.error(t('archive:save.someFailed', { failed: failed.length, total: saves.length }))
    }
    if (uploaded > 0) toast.success(uploaded === 1 ? t('archive:save.saved') : t('archive:save.savedMany', { count: uploaded }))
  }

  function discard() {
    void confirm({
      title: saves.length === 1 ? t('archive:save.discardOne') : t('archive:save.discardMany', { count: saves.length }),
      consequence: t('archive:save.discardBody'),
      confirmLabel: t('common:actions.discard'),
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
            {t('archive:save.title', { count: saves.length })}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5 rounded-md border p-2">
          {saves.map((save) => (
            <div key={save.id} className="flex items-center gap-2">
              <Input
                value={edits[save.id] ?? save.name}
                onChange={(e) => setEdits((prev) => ({ ...prev, [save.id]: e.target.value }))}
                className="min-w-0 flex-1"
                aria-label={t('archive:save.fileName', { name: save.name })}
              />
              {failedIds.includes(save.id) ? (
                <span className="shrink-0 text-xs text-destructive">{t('archive:save.error')}</span>
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
            {t('common:actions.discard')}
          </Button>
          <Button disabled={saving} onClick={() => void saveAll()}>
            {saving ? t('common:states.saving') : t('archive:save.here', { name: trail[trail.length - 1]?.name ?? t('common:nav.archive') })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
