import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'

const START_PX = 8

/** What a finished horizontal drag means: horizontal must dominate and pass the threshold. */
export function swipeOutcome(dx: number, dy: number, threshold: number): 'left' | 'right' | null {
  if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) return null
  return dx < 0 ? 'left' : 'right'
}

// Touch only. The drag starts once horizontal movement dominates, so a vertical scroll that
// begins on the row is never taken over. The caller renders the background that the row reveals.
export function useSwipeRow({ onSwipeLeft, onSwipeRight, threshold = 80 }: { onSwipeLeft?: () => void; onSwipeRight?: () => void; threshold?: number }) {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ x: number; y: number; pointerId: number; active: boolean } | null>(null)

  const reset = () => {
    start.current = null
    setDragging(false)
    setOffset(0)
  }
  // No pull toward a side that has no action.
  const clamp = (dx: number) => Math.min(onSwipeRight ? Infinity : 0, Math.max(onSwipeLeft ? -Infinity : 0, dx))

  const handlers = {
    onPointerDown(e: ReactPointerEvent) {
      if (e.pointerType !== 'touch') return
      start.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, active: false }
    },
    onPointerMove(e: ReactPointerEvent) {
      const origin = start.current
      if (!origin || e.pointerId !== origin.pointerId) return
      const dx = e.clientX - origin.x
      const dy = e.clientY - origin.y
      if (!origin.active) {
        if (Math.abs(dy) > START_PX && Math.abs(dy) >= Math.abs(dx)) {
          start.current = null
          return
        }
        if (Math.abs(dx) <= START_PX) return
        origin.active = true
        setDragging(true)
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      }
      setOffset(clamp(dx))
    },
    onPointerUp(e: ReactPointerEvent) {
      const origin = start.current
      if (!origin?.active) {
        start.current = null
        return
      }
      const outcome = swipeOutcome(clamp(e.clientX - origin.x), e.clientY - origin.y, threshold)
      reset()
      if (outcome === 'left') onSwipeLeft?.()
      else if (outcome === 'right') onSwipeRight?.()
    },
    onPointerCancel: reset,
  }

  const style: CSSProperties = {
    touchAction: 'pan-y',
    transform: offset ? `translateX(${offset}px)` : undefined,
    transition: dragging ? 'none' : 'transform var(--duration-standard) var(--ease-out)',
  }

  return { handlers, offset, style }
}
