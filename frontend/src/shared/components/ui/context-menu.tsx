import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { MenuContextProvider, MenuPanel } from './dropdown-menu'

// Right click on a row opens the same items as its ⋯ menu, at the cursor (E7, A11). The items are
// `DropdownMenuItem`s, so one list of actions serves both menus.

interface Point {
  x: number
  y: number
}

export function useContextMenu() {
  const [point, setPoint] = useState<Point | null>(null)
  const close = useCallback(() => setPoint(null), [])
  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setPoint({ x: e.clientX, y: e.clientY })
  }, [])
  return { point, close, onContextMenu }
}

type ContextMenuState = ReturnType<typeof useContextMenu>

export function ContextMenu({ state, children }: { state: ContextMenuState; children: ReactNode }) {
  if (!state.point) return null
  return (
    <ContextMenuPanel point={state.point} onClose={state.close}>
      {children}
    </ContextMenuPanel>
  )
}

const MARGIN = 8

function ContextMenuPanel({ point, onClose, children }: { point: Point; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [flip, setFlip] = useState({ x: false, y: false })

  // Measured once it is in the DOM: a menu opened near the right or bottom edge opens the other way.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    setFlip({
      x: point.x + panel.offsetWidth > window.innerWidth - MARGIN,
      y: point.y + panel.offsetHeight > window.innerHeight - MARGIN,
    })
  }, [point])

  const position = {
    left: flip.x ? undefined : point.x,
    right: flip.x ? window.innerWidth - point.x : undefined,
    top: flip.y ? undefined : point.y,
    bottom: flip.y ? Math.max(MARGIN, window.innerHeight - point.y) : undefined,
  }
  const origin = `${flip.y ? 'bottom' : 'top'} ${flip.x ? 'right' : 'left'}`

  return (
    <MenuContextProvider value={{ open: true, setOpen: (open) => !open && onClose(), triggerRef }}>
      <MenuPanel position={position} origin={origin} autoFocus panelRef={panelRef} onClose={onClose}>
        {children}
      </MenuPanel>
    </MenuContextProvider>
  )
}
