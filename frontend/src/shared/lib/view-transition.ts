// Cross-fade between pages through the View Transitions API. Where it is missing (older Android
// WebViews) or motion is reduced, the navigation simply happens, instantly.

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
// The new page is captured once it has rendered; a page whose code is still loading is not
// waited for longer than this, since the screen does not respond while a transition is pending.
const MAX_WAIT_MS = 300

let routeCommitted: (() => void) | null = null

export function navigateWithTransition(go: () => void) {
  if (typeof document.startViewTransition !== 'function' || reducedMotion?.matches) {
    go()
    return
  }
  document.startViewTransition(
    () =>
      new Promise<void>((resolve) => {
        routeCommitted = resolve
        go()
        setTimeout(resolve, MAX_WAIT_MS)
      }),
  )
}

/** Called by the layout once the new route has rendered. */
export function markRouteCommitted() {
  routeCommitted?.()
  routeCommitted = null
}

/** A plain left click; anything else (new tab, new window) is left to the browser. */
export function isPlainClick(e: React.MouseEvent) {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey
}
