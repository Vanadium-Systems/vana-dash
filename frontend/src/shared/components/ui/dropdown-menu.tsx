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
  children,
}: {
  position: MenuPosition
  origin: string
  autoFocus: boolean
  onClose: () => void
  panelRef: RefObject<HTMLDivElement>
  children: ReactNode
}) {
  useEffect(() => {
    const panel = panelRef.current
    if (autoFocus && panel) menuItems(panel)[0]?.focus()
    // Only on mount: re-measuring after a flip must not steal focus back to the first item.
  }, [])

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
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
  }, [onClose, panelRef])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!panelRef.current || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const items = menuItems(panelRef.current)
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length
    items[next]?.focus()
  }

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      // max-h + overflow: a menu opened on a bottom row cannot run past the screen.
      className="menu-pop glass fixed z-50 max-h-[calc(100vh-32px)] min-w-40 overflow-y-auto rounded-md border p-1 text-card-foreground shadow-md"
      style={{ ...position, '--menu-origin': origin } as CSSProperties}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>,
    document.body,
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
  useLayoutEffect(() => {
    if (!open || typeof pos?.top !== 'number' || !contentRef.current || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const height = contentRef.current.offsetHeight
    if (pos.top + height <= window.innerHeight - MARGIN) return
    if (height <= rect.top - MARGIN) {
      setAbove(true)
      setPos((p) => (p ? { ...p, top: undefined, bottom: window.innerHeight - rect.top + 4 } : p))
    } else {
      setPos((p) => (p ? { ...p, top: Math.max(MARGIN, window.innerHeight - MARGIN - height) } : p))
    }
  }, [open, pos, triggerRef])

  if (!open || !pos) return null
  const origin = `${above ? 'bottom' : 'top'} ${align === 'end' ? 'right' : 'left'}`
  return (
    <MenuPanel
      position={pos}
      origin={origin}
      autoFocus={openedFromKeyboard}
      panelRef={contentRef}
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
