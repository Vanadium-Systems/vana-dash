import { useSyncExternalStore } from 'react'

// Optional call: jsdom (tests) has no matchMedia.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia?.(query)
      list?.addEventListener('change', onChange)
      return () => list?.removeEventListener('change', onChange)
    },
    () => window.matchMedia?.(query).matches ?? false,
  )
}

export const FINE_POINTER = '(hover: hover) and (pointer: fine)'
