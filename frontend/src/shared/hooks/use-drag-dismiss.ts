import { useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

// A drag past `distance`, or a quick flick past `velocity` px/ms, dismisses; anything less springs
// back. The panel follows the finger only in the dismiss direction, so it cannot be pulled off its edge.
const DISTANCE = 80
const VELOCITY = 0.5

export function useDragDismiss(panelRef: RefObject<HTMLElement>, axis: 'down' | 'left', onDismiss: () => void) {
  const start = useRef<{ x: number; y: number; time: number; pointerId: number } | null>(null)

  const offsetOf = (e: ReactPointerEvent) => {
    if (!start.current) return 0
    return axis === 'down' ? Math.max(0, e.clientY - start.current.y) : Math.max(0, start.current.x - e.clientX)
  }
  const place = (offset: number) => {
    if (panelRef.current) panelRef.current.style.transform = offset ? (axis === 'down' ? `translateY(${offset}px)` : `translateX(${-offset}px)`) : ''
  }

  return {
    onPointerDown(e: ReactPointerEvent) {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      start.current = { x: e.clientX, y: e.clientY, time: e.timeStamp, pointerId: e.pointerId }
    },
    onPointerMove(e: ReactPointerEvent) {
      if (!start.current || e.pointerId !== start.current.pointerId) return
      const offset = offsetOf(e)
      if (offset > 4 && panelRef.current && !panelRef.current.hasAttribute('data-dragging')) {
        panelRef.current.setAttribute('data-dragging', '')
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      }
      if (panelRef.current?.hasAttribute('data-dragging')) place(offset)
    },
    onPointerUp(e: ReactPointerEvent) {
      if (!start.current) return
      const offset = offsetOf(e)
      const velocity = offset / Math.max(1, e.timeStamp - start.current.time)
      start.current = null
      panelRef.current?.removeAttribute('data-dragging')
      if (offset > DISTANCE || (offset > 10 && velocity > VELOCITY)) {
        // Set synchronously, so the panel slides out from where the finger left it instead of
        // snapping back for a frame before React renders the closing state.
        panelRef.current?.setAttribute('data-state', 'closing')
        place(0)
        onDismiss()
      } else place(0)
    },
    onPointerCancel() {
      start.current = null
      panelRef.current?.removeAttribute('data-dragging')
      place(0)
    },
  }
}
