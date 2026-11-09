import { useRef, type MouseEvent } from 'react'
import type { useSelection } from '@/shared/hooks/use-selection'

const LONG_PRESS_MS = 450

type Selection = Pick<ReturnType<typeof useSelection<string>>, 'onRowClick' | 'toggle'>

/**
 * What a click on a row does: Ctrl/Cmd and Shift select (a range from the last one clicked), a plain
 * click opens, but once anything is selected a plain click selects too. On a phone a long press
 * starts the selection, and the tap that ends it must not also open the row.
 */
export function useRowActivation<Item extends { id: string }>(selection: Selection, open: (item: Item) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)

  const cancelLongPress = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  return {
    onActivate(e: Pick<MouseEvent, 'ctrlKey' | 'metaKey' | 'shiftKey'>, item: Item) {
      if (longPressFired.current) {
        longPressFired.current = false
        return
      }
      if (selection.onRowClick(e, item.id)) return
      open(item)
    },
    startLongPress(id: string) {
      longPressFired.current = false
      cancelLongPress()
      timer.current = setTimeout(() => {
        longPressFired.current = true
        selection.toggle(id)
      }, LONG_PRESS_MS)
    },
    cancelLongPress,
  }
}
