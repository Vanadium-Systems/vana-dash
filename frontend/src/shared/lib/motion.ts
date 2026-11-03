export type MotionLevel = 'full' | 'reduced' | 'off'
export type MotionPref = 'system' | MotionLevel

const QUERY = '(prefers-reduced-motion: reduce)'

let currentPref: MotionPref = 'system'

export function motionLevel(): MotionLevel {
  if (currentPref !== 'system') return currentPref
  return window.matchMedia?.(QUERY).matches ? 'reduced' : 'full'
}

// CSS reads the level from this attribute, so the person's setting (not only the OS one) drives it.
export function applyMotionPref(pref: MotionPref) {
  currentPref = pref
  document.documentElement.dataset.motion = motionLevel()
}

// The OS setting can change while the page is open; it only matters while the pref follows it.
if (typeof window !== 'undefined') {
  window.matchMedia?.(QUERY).addEventListener?.('change', () => {
    if (currentPref === 'system') applyMotionPref('system')
  })
}
