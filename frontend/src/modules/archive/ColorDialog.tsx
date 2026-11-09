import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { ColorPicker } from '@/shared/components/ui/color-picker'
import { t } from '@/shared/lib/i18n'

/** Picking a color applies it and closes: there is nothing else to fill in. */
export function ColorDialog({ name, value, onPick, onClose }: { name: string; value: number | null; onPick: (color: number | null) => void; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('archive:color.title', { name })}</DialogTitle>
        </DialogHeader>
        <ColorPicker
          value={value}
          onChange={(color) => {
            onPick(color)
            onClose()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
