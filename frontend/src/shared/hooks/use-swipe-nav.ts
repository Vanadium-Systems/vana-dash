import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { swipeOutcome } from './use-swipe-row'

const THRESHOLD_PX = 60

// A swipe left goes forward (next), right goes back; touch only, and a mostly vertical drag is a scroll.
export function useSwipeNav({ onPrev, onNext }: { onPrev: () => void; onNext: () => void }) {
  const start = useRef<{ x: number; y: number; pointerId: number } | null>(null)

  const handlers = {
    onPointerDown(e: ReactPointerEvent) {
      start.current = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY, pointerId: e.pointerId } : null
    },
    onPointerUp(e: ReactPointerEvent) {
      const origin = start.current
      start.current = null
      if (!origin || e.pointerId !== origin.pointerId) return
      const outcome = swipeOutcome(e.clientX - origin.x, e.clientY - origin.y, THRESHOLD_PX)
      if (outcome === 'left') onNext()
      else if (outcome === 'right') onPrev()
    },
    onPointerCancel() {
      start.current = null
    },
  }
  const style: CSSProperties = { touchAction: 'pan-y' }

  return { handlers, style }
}
