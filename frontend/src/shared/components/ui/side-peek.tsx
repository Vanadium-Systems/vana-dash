import { X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useUrlState } from '@/shared/hooks/use-url-state'
import { t } from '@/shared/lib/i18n'
import { cn } from '@/shared/lib/utils'

/** The id of the open peek lives in the URL (`?peek=<id>`), so a refresh or a shared link reopens it. */
export function usePeek(param = 'peek'): [string | null, (id: string) => void, () => void] {
  const [openId, setOpenId] = useUrlState(param)
  const close = useCallback(() => setOpenId(''), [setOpenId])
  return [openId || null, setOpenId, close]
}

// A detail that floats beside the list instead of replacing it: the list stays visible and
// interactive behind. Full screen on a phone, where there is no room beside anything.
export function SidePeek({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panelRef.current?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // A confirm or dialog opened from inside the peek takes Esc first.
      const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"]')
      if (dialogs[dialogs.length - 1] !== panelRef.current) return
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      opener?.focus()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={cn(
        'glass peek-panel safe-top safe-bottom fixed inset-0 z-40 flex flex-col overflow-hidden border focus:outline-none',
        'md:inset-y-2 md:left-auto md:right-2 md:w-[min(28rem,calc(100vw-1rem))] md:rounded-xl md:shadow-xl',
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <h2 id={titleId} className="min-w-0 truncate text-base font-semibold">
          {title}
        </h2>
        <button type="button" onClick={onClose} className="rounded-sm p-1 opacity-70 transition-opacity hover:opacity-100" aria-label={t('common:actions.close')}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </div>,
    document.body,
  )
}
