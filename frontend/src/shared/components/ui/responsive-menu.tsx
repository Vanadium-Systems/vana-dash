import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { DropdownMenu, DropdownMenuContent, MenuContextProvider, useMenuState } from './dropdown-menu'
import { useDragDismiss } from '@/shared/hooks/use-drag-dismiss'

// A row's menu: the dropdown on a desktop, a bottom sheet on a phone, with the object's name on top
// and 48dp rows within reach of the thumb (#5, A26). Same items, same trigger, so a ⋯ menu becomes
// responsive by swapping `DropdownMenuContent` for `ResponsiveMenuContent`.

// Optional call: jsdom (tests) has no matchMedia, and this runs at import.
const touchQuery = window.matchMedia?.('(max-width: 767px), (pointer: coarse)')

function useSheetLayout() {
  return useSyncExternalStore(
    (onChange) => {
      touchQuery?.addEventListener('change', onChange)
      return () => touchQuery?.removeEventListener('change', onChange)
    },
    () => touchQuery?.matches ?? false,
  )
}

export { DropdownMenu as ResponsiveMenu }

export function ResponsiveMenuContent({ title, align, children }: { title: ReactNode; align?: 'start' | 'end'; children: ReactNode }) {
  const sheet = useSheetLayout()
  const menu = useMenuState('ResponsiveMenuContent')
  if (!sheet) return <DropdownMenuContent align={align}>{children}</DropdownMenuContent>
  return (
    <BottomSheet open={menu.open} onClose={() => menu.setOpen(false)} title={title} role="menu">
      {/* The sheet sits in a portal, outside <DropdownMenu>, so the items get the menu's context again. */}
      <MenuContextProvider value={menu}>
        <div className="[&_[role=menuitem]]:min-h-12 [&_[role=menuitem]]:gap-3 [&_[role=menuitem]]:px-3 [&_[role=menuitem]]:text-base">{children}</div>
      </MenuContextProvider>
    </BottomSheet>
  )
}

/**
 * Slides up on --ease-drawer, closes on the backdrop, Esc (Back in the APK sends Esc,
 * `native-back.ts`) or a swipe down. Stays mounted while it slides out.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  role = 'dialog',
  children,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  role?: 'dialog' | 'menu'
  children: ReactNode
}) {
  const [mounted, setMounted] = useState(open)
  const panelRef = useRef<HTMLDivElement>(null)
  const drag = useDragDismiss(panelRef, 'down', onClose)

  useEffect(() => {
    if (open) {
      setMounted(true)
      return
    }
    // transitionend never comes where nothing animates (no transition support, a hidden tab).
    const fallback = setTimeout(() => setMounted(false), 400)
    return () => clearTimeout(fallback)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!mounted) return null
  const state = open ? 'open' : 'closing'
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div data-state={state} className="sheet-backdrop absolute inset-0 bg-black/50 opacity-100" onClick={onClose} />
      <div
        ref={panelRef}
        role={role}
        aria-label={typeof title === 'string' ? title : undefined}
        data-state={state}
        className="sheet-panel glass safe-bottom absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto overscroll-contain rounded-t-xl border-t p-2 pt-0 text-card-foreground"
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && !open) setMounted(false)
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="-mx-2 cursor-grab touch-none px-2 pb-2 pt-2" {...drag}>
          <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/40" />
          {title ? <div className="truncate px-3 pb-1 text-sm font-medium text-muted-foreground">{title}</div> : null}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
