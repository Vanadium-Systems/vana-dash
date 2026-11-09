import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'

export const CARD_WIDTH = 240
export const GAP = 12

export interface CardSlot {
  column: number
  top: number
}

/**
 * Reading order, left to right: each card goes into the shortest column (the leftmost on a tie),
 * like Keep. `column-count` would fill column by column and break that order.
 */
export function layoutMasonry(heights: number[], columns: number, gap = GAP): { slots: CardSlot[]; height: number } {
  const columnHeights = Array.from({ length: Math.max(1, columns) }, () => 0)
  const slots = heights.map((height): CardSlot => {
    let column = 0
    for (let i = 1; i < columnHeights.length; i++) if (columnHeights[i]! < columnHeights[column]!) column = i
    const top = columnHeights[column]!
    columnHeights[column] = top + height + gap
    return { column, top }
  })
  return { slots, height: Math.max(0, Math.max(...columnHeights) - gap) }
}

export interface MasonryGeometry {
  columns: number
  cardWidth: number
  /** Left edge of the first column: 0, so the grid lines up with the page title and the tabs. */
  offsetX: number
}

/** Fixed 240px columns as many as fit; under two columns' worth (a phone) exactly two, fluid. */
export function masonryGeometry(containerWidth: number, gap = GAP): MasonryGeometry {
  if (containerWidth < 2 * CARD_WIDTH + gap) {
    return { columns: 2, cardWidth: Math.max(0, (containerWidth - gap) / 2), offsetX: 0 }
  }
  const columns = Math.floor((containerWidth + gap) / (CARD_WIDTH + gap))
  return { columns, cardWidth: CARD_WIDTH, offsetX: 0 }
}

/**
 * Measures the container and every card, and returns each card's position. Cards are absolutely
 * placed (translate), so a card that changes column keeps its DOM node, which is also what lets
 * the move animate.
 */
export function useMasonry(ids: string[], containerRef: RefObject<HTMLElement>) {
  const [width, setWidth] = useState(0)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const observer = useRef<ResizeObserver | null>(null)
  const nodes = useRef(new Map<string, HTMLElement>())

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    setWidth(container.clientWidth)
    const resize = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width))
    resize.observe(container)
    return () => resize.disconnect()
  }, [containerRef])

  useEffect(() => {
    observer.current = new ResizeObserver((entries) => {
      setHeights((current) => {
        let next = current
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.noteId
          const height = Math.ceil(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height)
          if (id && current[id] !== height) next = { ...next, [id]: height }
        }
        return next
      })
    })
    nodes.current.forEach((node) => observer.current?.observe(node))
    return () => observer.current?.disconnect()
  }, [])

  /** Ref callback for a card; the card carries `data-note-id`. */
  const measure = (id: string) => (node: HTMLElement | null) => {
    const known = nodes.current.get(id)
    if (known && known !== node) observer.current?.unobserve(known)
    if (!node) {
      nodes.current.delete(id)
      return
    }
    nodes.current.set(id, node)
    observer.current?.observe(node)
  }

  const geometry = useMemo(() => masonryGeometry(width), [width])
  const layout = useMemo(() => layoutMasonry(ids.map((id) => heights[id] ?? 120), geometry.columns), [ids, heights, geometry.columns])

  const position = (index: number) => {
    const slot = layout.slots[index]!
    return { x: geometry.offsetX + slot.column * (geometry.cardWidth + GAP), y: slot.top, width: geometry.cardWidth }
  }

  return { measure, position, height: layout.height, ready: width > 0 }
}
