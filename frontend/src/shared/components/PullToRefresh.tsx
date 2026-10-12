import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

// Doar în shell-ul Capacitor: WebView-ul Android n-are pull-to-refresh nativ, iar în APK nu
// există bară de browser cu buton de reload. Reload complet (nu doar refetch React Query), ca
// tragerea în jos să aducă și un deploy nou, nu doar date proaspete.

const THRESHOLD_PX = 70
const MAX_PULL_PX = 110
// Rezistență: degetul trebuie să meargă ~2x distanța afișată, ca la pull-to-refresh-ul nativ.
const RESISTANCE = 0.5

// Pornește doar dacă tot lanțul de scroll de sub deget e deja sus — altfel o listă internă
// derulată (ex. inbox-ul) ar da reload în loc să urce.
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

export function PullToRefresh() {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const activeRef = useRef(false)
  const pullRef = useRef(0)

  useEffect(() => {
    const reset = () => {
      startRef.current = null
      activeRef.current = false
      pullRef.current = 0
      setPull(0)
    }

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || isBlockedTarget(event.target) || !isScrolledToTop(event.target)) {
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
        // Swipe orizontal (tabele, carusele) sau în sus → nu e gestul nostru.
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
        setRefreshing(true)
        setPull(THRESHOLD_PX)
        window.location.reload()
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

  if (pull === 0 && !refreshing) return null

  const progress = Math.min(1, pull / THRESHOLD_PX)
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center"
      style={{ transform: `translateY(calc(env(safe-area-inset-top, 0px) + ${pull - 40}px))` }}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-input bg-card text-card-foreground shadow-md">
        <RefreshCw
          className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'}
          style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)`, opacity: 0.4 + progress * 0.6 }}
        />
      </div>
    </div>
  )
}
