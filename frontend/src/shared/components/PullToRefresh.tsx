import { RefreshCw } from 'lucide-react'
import { THRESHOLD_PX, currentPageRefresh, usePullToRefresh } from '@/shared/hooks/use-pull-to-refresh'

// Capacitor shell only: the Android WebView has no native pull-to-refresh and the APK has no
// browser reload button. Full reload (not just a React Query refetch), so a pull also brings a
// new deploy, except on pages that take the gesture over with `usePageRefresh`.
export function PullToRefresh() {
  const { pull, refreshing } = usePullToRefresh(() => {
    const pageRefresh = currentPageRefresh()
    if (pageRefresh) return pageRefresh()
    window.location.reload()
    // The spinner stays until the page unloads.
    return new Promise(() => {})
  })

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
