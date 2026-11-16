import { useSyncExternalStore } from 'react'
import { Toaster } from './toast'

// One toast for the whole app (DESIGN.md): text and a second line, then [action] [x] on one row.
const phoneQuery = window.matchMedia('(max-width: 767px)')

export function AppToaster() {
  const phone = useSyncExternalStore(
    (onChange) => {
      phoneQuery.addEventListener('change', onChange)
      return () => phoneQuery.removeEventListener('change', onChange)
    },
    () => phoneQuery.matches,
  )

  return (
    <Toaster
      // On a phone toasts sit at the bottom, by the thumb and above the bottom nav (MA12).
      position={phone ? 'bottom-center' : 'top-right'}
      offset={phone ? 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' : undefined}
      closeButton
    />
  )
}
