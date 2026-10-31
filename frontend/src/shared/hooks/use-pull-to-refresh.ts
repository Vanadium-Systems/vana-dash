import { useEffect, useRef, useState } from 'react'

export const THRESHOLD_PX = 70
const MAX_PULL_PX = 110
// Resistance: the finger has to travel about twice the distance shown, as in a native pull-to-refresh.
const RESISTANCE = 0.5

type Refresh = () => Promise<unknown> | void

// A page can take over the gesture (refetch its own data instead of reloading the whole app). The
// last page mounted wins, so a page opened over another one is the one that answers.
const pageHandlers: Refresh[] = []

export function registerPageRefresh(handler: Refresh): () => void {
  pageHandlers.push(handler)
  return () => {
    const at = pageHandlers.lastIndexOf(handler)
    if (at !== -1) pageHandlers.splice(at, 1)
  }
}

export function currentPageRefresh(): Refresh | undefined {
  return pageHandlers.at(-1)
}

export function usePageRefresh(handler: Refresh) {
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => registerPageRefresh(() => latest.current()), [])
}

// Starts only if the whole scroll chain under the finger is already at the top, otherwise an
// inner list scrolled down (e.g. the inbox) would refresh instead of scrolling up.
function isScrolledToTop(target: EventTarget | null): boolean {
  if (window.scrollY > 0) return false
  let node = target instanceof Element ? target : null
  while (node && node !== document.body) {
    if (node.scrollTop > 0) return false
    node = node.parentElement
  }
  return true
}

function isBlockedTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true
  return Boolean(target.closest('[role="dialog"], [role="menu"], [role="listbox"], input, textarea, select, [contenteditable="true"]'))
}

export function usePullToRefresh(onRefresh: Refresh) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const activeRef = useRef(false)
  const pullRef = useRef(0)
  const refreshingRef = useRef(false)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  useEffect(() => {
    const reset = () => {
      startRef.current = null
      activeRef.current = false
      pullRef.current = 0
      setPull(0)
    }

    const onTouchStart = (event: TouchEvent) => {
      if (refreshingRef.current || event.touches.length !== 1 || isBlockedTarget(event.target) || !isScrolledToTop(event.target)) {
        startRef.current = null
        return
      }
      const touch = event.touches[0]!
      startRef.current = { x: touch.clientX, y: touch.clientY }
      activeRef.current = false
    }

    const onTouchMove = (event: TouchEvent) => {
      const start = startRef.current
      if (!start) return
      const touch = event.touches[0]!
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y

      if (!activeRef.current) {
        // Horizontal swipe (tables, carousels) or upward: not our gesture.
        if (Math.abs(dx) > Math.abs(dy) || dy <= 0) {
          if (Math.abs(dx) > 8 || dy < -8) startRef.current = null
          return
        }
        if (dy < 8) return
        activeRef.current = true
      }

      if (event.cancelable) event.preventDefault()
      const distance = Math.min(MAX_PULL_PX, Math.max(0, dy * RESISTANCE))
      pullRef.current = distance
      setPull(distance)
    }

    const onTouchEnd = () => {
      if (activeRef.current && pullRef.current >= THRESHOLD_PX) {
        refreshingRef.current = true
        setRefreshing(true)
        setPull(THRESHOLD_PX)
        void Promise.resolve(onRefreshRef.current()).finally(() => {
          refreshingRef.current = false
          setRefreshing(false)
          reset()
        })
        return
      }
      reset()
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd)
    window.addEventListener('touchcancel', reset)
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', reset)
    }
  }, [])

  return { pull, refreshing }
}
