import type { LucideIcon } from 'lucide-react'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { FeatureKey } from './types'

// What the open page offers in Ctrl K ("Pe pagina asta"). A page registers its actions while it
// is mounted; the palette reads them. Not a context: the palette lives in the shell, above the pages.

export interface PageAction {
  id: string
  label: string
  icon?: LucideIcon
  run: () => void
  feature?: FeatureKey
}

let registered: Array<{ owner: symbol; actions: PageAction[] }> = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePageActions(actions: PageAction[]): void {
  const owner = useRef(Symbol('page-actions'))
  // The page rebuilds `actions` on every render; the palette only needs the latest ones.
  useEffect(() => {
    registered = [...registered.filter((entry) => entry.owner !== owner.current), { owner: owner.current, actions }]
    emit()
  })
  useEffect(
    () => () => {
      registered = registered.filter((entry) => entry.owner !== owner.current)
      emit()
    },
    [],
  )
}

let snapshot: PageAction[] = []
function currentActions(): PageAction[] {
  const flat = registered.flatMap((entry) => entry.actions)
  if (flat.length === snapshot.length && flat.every((action, i) => action === snapshot[i])) return snapshot
  snapshot = flat
  return snapshot
}

export function useRegisteredPageActions(): PageAction[] {
  return useSyncExternalStore(subscribe, currentActions)
}
