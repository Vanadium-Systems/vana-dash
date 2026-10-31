import { useState } from 'react'
import { isMac } from '@/shared/components/CommandPalette'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { useActiveHotkeys, useHotkeys } from '@/shared/hooks/use-hotkeys'
import { t } from '@/shared/lib/i18n'

const KEY_NAMES: Record<string, string> = isMac
  ? { mod: '⌘', shift: '⇧', alt: '⌥', escape: 'Esc' }
  : { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', escape: 'Esc' }

function keyCaps(keys: string): string[] {
  return keys.split('+').map((key) => KEY_NAMES[key.toLowerCase()] ?? key.toUpperCase())
}

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false)
  useHotkeys([{ keys: 'shift+?', label: t('common:shortcuts.help'), onKey: () => setOpen((current) => !current) }])
  const hotkeys = useActiveHotkeys()

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t('common:shortcuts.title')}</DialogTitle>
        </DialogHeader>
        <ul className="divide-y text-sm">
          {hotkeys.map((hotkey) => (
            <li key={hotkey.keys + hotkey.label} className="flex items-center justify-between gap-4 py-2">
              <span>{hotkey.label}</span>
              <span className="flex shrink-0 gap-1">
                {keyCaps(hotkey.keys).map((cap) => (
                  <kbd key={cap} className="min-w-6 rounded border bg-muted px-1.5 py-0.5 text-center font-sans text-xs">
                    {cap}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
