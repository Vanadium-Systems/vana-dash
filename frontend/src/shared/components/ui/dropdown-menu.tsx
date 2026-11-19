import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/shared/lib/utils'

// No Radix: native, like select / tabs / checkbox. The content renders in a portal on
// `document.body`, `fixed` at the trigger's `getBoundingClientRect()`; a local
// `position: absolute` inside a table cell got clipped by the scrolling container.

interface MenuContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: RefObject<HTMLButtonElement>
}

const MenuContext = createContext<MenuContextValue | null>(null)

function useMenuContext(component: string) {
  const ctx = useContext(MenuContext)
  if (!ctx) throw new Error(`${component} must be used inside <DropdownMenu> or <ContextMenu>`)
  return ctx
}

export const MenuContextProvider = MenuContext.Provider

// A layer that sits above the default one (the file viewer) lifts the menus opened inside it.
const MenuLayerContext = createContext('z-50')
export const MenuLayerProvider = MenuLayerContext.Provider
export const useMenuLayer = () => useContext(MenuLayerContext)
export const useMenuState = useMenuContext

/** Opened from the keyboard (Enter / Space give a click with `detail === 0`), the first item takes focus. */
let openedFromKeyboard = false

// `open` / `onOpenChange` are optional: in Messages a long press opens the same menu as the
// button, so the state has to live in the row.
export function DropdownMenu({
  children,
  open: controlledOpen,
  onOpenChange,
}: {
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = onOpenChange ?? setUncontrolledOpen
  const triggerRef = useRef<HTMLButtonElement>(null)
  // `max-w-full` is load-bearing: `inline-block` sizes to its content, so a long trigger (the
  // account menu: name + email) would widen the sidebar, and `truncate` would have nothing to cut.
  return (
    <MenuContext.Provider value={{ open, setOpen, triggerRef }}>
      <div className="inline-block max-w-full">{children}</div>
    </MenuContext.Provider>
  )
}

export function DropdownMenuTrigger({ children, className }: { children: ReactNode; className?: string }) {
  const { open, setOpen, triggerRef } = useMenuContext('DropdownMenuTrigger')
  return (
    <button
      ref={triggerRef}
      type="button"
      aria-haspopup="menu"
      aria-expanded={open}
      className={className}
      onClick={(e) => {
        e.stopPropagation()
        openedFromKeyboard = e.detail === 0
        setOpen(!open)
      }}
    >
      {children}
    </button>
  )
}

type MenuPosition = Pick<CSSProperties, 'top' | 'bottom' | 'left' | 'right'>

const MARGIN = 16

/** A modal dialog (Radix) makes everything outside it unclickable and pulls focus back into it,
 *  so a menu opened inside one is mounted in the dialog instead of on `document.body`. */
export function dialogHost(el: Element | null | undefined): HTMLElement | null {
  return el?.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]') ?? null
}

function boundsOf(host: HTMLElement | null): { top: number; bottom: number; left: number; right: number } {
  return host?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth }
}

// The dialog is a positioned (and on desktop transformed) box that scrolls: viewport offsets
// become offsets from its padding box, scroll included.
function positionIn(host: HTMLElement, position: MenuPosition): MenuPosition {
  const box = host.getBoundingClientRect()
  const borderRight = host.offsetWidth - host.clientWidth - host.clientLeft
  const borderBottom = host.offsetHeight - host.clientHeight - host.clientTop
  const shifted: MenuPosition = {}
  if (typeof position.top === 'number') shifted.top = position.top - box.top - host.clientTop + host.scrollTop
  if (typeof position.left === 'number') shifted.left = position.left - box.left - host.clientLeft + host.scrollLeft
  if (typeof position.right === 'number') shifted.right = position.right - (window.innerWidth - box.right) - borderRight - host.scrollLeft
  if (typeof position.bottom === 'number') shifted.bottom = position.bottom - (window.innerHeight - box.bottom) - borderBottom - host.scrollTop
  return shifted
}

function menuItems(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'))
}

/**
 * The floating panel shared by the dropdown and the context menu: closes on outside press, Esc,
 * scroll and resize, moves focus with the arrows and grows from `origin` (MA2).
 */
export function MenuPanel({
  position,
  origin,
  autoFocus,
  onClose,
  panelRef,
  triggerRef,
  children,
}: {
  position: MenuPosition
  origin: string
  autoFocus: boolean
  onClose: () => void
  panelRef: RefObject<HTMLDivElement>
  /** A press on the trigger is left to its own click, which toggles: closing here on mousedown
   *  and reopening on click made a second press reopen the menu instead of closing it. */
  triggerRef?: RefObject<HTMLElement>
  children: ReactNode
}) {
  useEffect(() => {
    const panel = panelRef.current
    if (autoFocus && panel) menuItems(panel)[0]?.focus({ preventScroll: true })
    // Only on mount: re-measuring after a flip must not steal focus back to the first item.
  }, [])

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (triggerRef?.current?.contains(target)) return
      if (panelRef.current && !panelRef.current.contains(target)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // The position is measured once; on scroll the menu closes rather than floating away from
    // a row that moved under it. Scrolling inside the menu itself is fine.
    const onScroll = (e: Event) => {
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return
      onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose, panelRef, triggerRef])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!panelRef.current || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const items = menuItems(panelRef.current)
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length
    items[next]?.focus({ preventScroll: true })
  }

  const layer = useMenuLayer()
  const host = dialogHost(triggerRef?.current)
  const placed: CSSProperties = host
    ? { ...positionIn(host, position), maxHeight: host.clientHeight - 2 * MARGIN, position: 'absolute' }
    : { ...position, position: 'fixed' }
  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      // max-h + overflow: a menu opened on a bottom row cannot run past the screen.
      className={cn('menu-pop glass max-h-[calc(100vh-32px)] min-w-40 overflow-y-auto rounded-md border p-1 text-card-foreground shadow-md', layer)}
      style={{ ...placed, '--menu-origin': origin } as CSSProperties}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>,
    host ?? document.body,
  )
}

export function DropdownMenuContent({ children, align = 'end' }: { children: ReactNode; align?: 'start' | 'end' }) {
  const { open, setOpen, triggerRef } = useMenuContext('DropdownMenuContent')
  const contentRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<MenuPosition | null>(null)
  const [above, setAbove] = useState(false)

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPos(null)
      setAbove(false)
      return
    }
    const rect = triggerRef.current.getBoundingClientRect()
    setPos(align === 'end' ? { top: rect.bottom + 4, right: window.innerWidth - rect.right } : { top: rect.bottom + 4, left: rect.left })
  }, [open, align, triggerRef])

  // Once measurable: open upwards if it does not fit below (and fits above), otherwise pin it to
  // the bottom margin. On a phone the gesture bar covers the very bottom, hiding the last items.
  // Inside a dialog the menu is mounted there and clipped by it, so the dialog's box is the limit.
  useLayoutEffect(() => {
    if (!open || typeof pos?.top !== 'number' || !contentRef.current || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const box = boundsOf(dialogHost(triggerRef.current))
    const height = contentRef.current.offsetHeight
    if (pos.top + height <= box.bottom - MARGIN) return
    if (height <= rect.top - box.top - MARGIN) {
      setAbove(true)
      setPos((p) => (p ? { ...p, top: undefined, bottom: window.innerHeight - rect.top + 4 } : p))
    } else {
      const top = Math.max(box.top + MARGIN, box.bottom - MARGIN - height)
      if (top !== pos.top) setPos((p) => (p ? { ...p, top } : p))
    }
  }, [open, pos, triggerRef])

  // A wide panel (the note editor) next to the edge slides back in instead of overflowing.
  useLayoutEffect(() => {
    if (!open || !pos || !contentRef.current) return
    const box = boundsOf(dialogHost(triggerRef.current))
    const width = contentRef.current.offsetWidth
    const leftLimit = Math.max(box.left + MARGIN, box.right - MARGIN - width)
    const rightLimit = Math.max(window.innerWidth - box.right + MARGIN, window.innerWidth - box.left - MARGIN - width)
    if (typeof pos.left === 'number' && pos.left > leftLimit) setPos((p) => (p ? { ...p, left: leftLimit } : p))
    if (typeof pos.right === 'number' && pos.right > rightLimit) setPos((p) => (p ? { ...p, right: rightLimit } : p))
  }, [open, pos, triggerRef])

  if (!open || !pos) return null
  const origin = `${above ? 'bottom' : 'top'} ${align === 'end' ? 'right' : 'left'}`
  return (
    <MenuPanel
      position={pos}
      origin={origin}
      autoFocus={openedFromKeyboard}
      panelRef={contentRef}
      triggerRef={triggerRef}
      onClose={() => {
        if (contentRef.current?.contains(document.activeElement)) triggerRef.current?.focus()
        setOpen(false)
      }}
    >
      {children}
    </MenuPanel>
  )
}

export function DropdownMenuItem({
  children,
  onClick,
  destructive,
  disabled,
  className,
}: {
  children: ReactNode
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
  className?: string
}) {
  const { setOpen } = useMenuContext('DropdownMenuItem')
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
        destructive && 'text-destructive hover:bg-destructive/10 focus:text-destructive',
        className,
      )}
      onClick={(e) => {
        e.stopPropagation()
        setOpen(false)
        onClick()
      }}
    >
      {children}
    </button>
  )
}

/** The key that does the same thing, at the right of the item (`E`, `Ctrl Enter`). */
export function MenuShortcut({ children }: { children: ReactNode }) {
  return <kbd className="ml-auto pl-4 font-sans text-xs text-muted-foreground">{children}</kbd>
}

export function DropdownMenuSeparator() {
  return <div role="separator" className="-mx-1 my-1 h-px bg-border" />
}
