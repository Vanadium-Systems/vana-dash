import { useCallback, useEffect, useRef, useState } from 'react'

interface ClickModifiers {
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/** Ids from `anchor` to `target` inclusive, in list order; just `[target]` when the anchor is gone. */
export function selectRange<Id extends string>(orderedIds: Id[], anchor: Id | null, target: Id): Id[] {
  const from = anchor === null ? -1 : orderedIds.indexOf(anchor)
  const to = orderedIds.indexOf(target)
  if (to === -1) return []
  if (from === -1) return [target]
  return orderedIds.slice(Math.min(from, to), Math.max(from, to) + 1)
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

export function useSelection<Id extends string>(orderedIds: Id[]) {
  const [selected, setSelected] = useState<Set<Id>>(() => new Set())
  const anchor = useRef<Id | null>(null)

  // A refetch or a filter can remove rows that were selected; acting on ids nobody sees is worse than losing them.
  useEffect(() => {
    setSelected((current) => {
      const present = new Set(orderedIds)
      const kept = [...current].filter((id) => present.has(id))
      return kept.length === current.size ? current : new Set(kept)
    })
  }, [orderedIds])

  const count = selected.size

  useEffect(() => {
    if (count === 0) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isTyping(e.target)) setSelected(new Set())
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [count])

  const toggle = useCallback((id: Id) => {
    anchor.current = id
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])

  const onRowClick = (e: ClickModifiers, id: Id): boolean => {
    if (e.ctrlKey || e.metaKey) {
      toggle(id)
      return true
    }
    if (e.shiftKey) {
      const range = selectRange(orderedIds, anchor.current, id)
      anchor.current ??= id
      setSelected((current) => new Set([...current, ...range]))
      return true
    }
    if (count > 0) {
      toggle(id)
      return true
    }
    return false
  }

  const allSelected = count > 0 && count === orderedIds.length

  return {
    selected,
    isSelected: (id: Id) => selected.has(id),
    toggle,
    onRowClick,
    selectAll: () => setSelected(new Set(orderedIds)),
    clear: () => setSelected(new Set()),
    allSelected,
    someSelected: count > 0 && !allSelected,
    count,
  }
}
