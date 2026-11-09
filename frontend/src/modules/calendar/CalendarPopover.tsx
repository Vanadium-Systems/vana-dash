import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BottomSheet } from '@/shared/components/ui/responsive-menu'
import { useMediaQuery } from '@/shared/hooks/use-media-query'

const MARGIN = 12
const WIDTH = 360

/**
 * A panel next to a point on the grid (the event clicked, the range drawn): to its right when
 * there is room, otherwise to its left, kept inside the window. A bottom sheet on a phone.
 * Closes on Esc and on a press outside it (dialogs, menus and toasts opened from it do not count).
 */
export function CalendarPopover({
  anchor,
  title,
  placement = 'side',
  onClose,
  children,
}: {
  anchor: DOMRect | null
  title: string
  /** `side` beside a block on the grid, `below` under a toolbar button. */
  placement?: 'side' | 'below'
  onClose: () => void
  children: ReactNode
}) {
  const phone = useMediaQuery('(max-width: 639px)')
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useLayoutEffect(() => {
    if (!anchor || phone || !panelRef.current) return
    const height = panelRef.current.offsetHeight
    if (placement === 'below') {
      setPos({ top: anchor.bottom + 4, left: Math.min(Math.max(MARGIN, anchor.right - WIDTH), window.innerWidth - MARGIN - WIDTH) })
      return
    }
    const right = anchor.right + 8
    const left = right + WIDTH <= window.innerWidth - MARGIN ? right : Math.max(MARGIN, anchor.left - WIDTH - 8)
    const top = Math.min(Math.max(MARGIN, anchor.top), window.innerHeight - MARGIN - height)
    setPos({ top: Math.max(MARGIN, top), left })
  }, [anchor, phone, placement])

  useEffect(() => {
    if (!anchor || phone) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // A dialog opened from inside the popover (the series choice) takes Esc first.
      if (document.querySelector('[role="alertdialog"], [role="dialog"]:not([data-calendar-popover])')) return
      onCloseRef.current()
    }
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element
      if (panelRef.current?.contains(target)) return
      // The button that opened it toggles it itself; closing here would reopen it on the click.
      if (target.closest?.('[role="dialog"], [role="alertdialog"], [role="menu"], [data-sonner-toaster], [aria-expanded="true"]')) return
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    // On the next tick: the press that opened the popover must not close it.
    const id = setTimeout(() => document.addEventListener('mousedown', onDown))
    return () => {
      clearTimeout(id)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [anchor, phone])

  if (!anchor) return null
  if (phone) {
    return (
      <BottomSheet open onClose={onClose} title={title}>
        <div className="px-3 pb-2">{children}</div>
      </BottomSheet>
    )
  }
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={title}
      data-calendar-popover=""
      className="menu-pop glass fixed z-40 max-h-[calc(100vh-24px)] overflow-y-auto rounded-lg border p-4 text-card-foreground shadow-lg"
      // Opacity, not visibility, until measured: a `visibility: hidden` field cannot take autoFocus.
      style={{ width: WIDTH, top: pos?.top ?? anchor.top, left: pos?.left ?? anchor.right + 8, opacity: pos ? undefined : 0 }}
    >
      {children}
    </div>,
    document.body,
  )
}
