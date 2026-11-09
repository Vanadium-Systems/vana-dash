import { arrayMove } from '@dnd-kit/sortable'

/** Goal ids per tier, in order. */
export type TierItems = Record<number, string[]>

export const TIER_KEY_PREFIX = 'tier-'

export const tierDropId = (tier: number) => `${TIER_KEY_PREFIX}${tier}`

export function tierOfContainer(items: TierItems, id: string): number | null {
  if (id.startsWith(TIER_KEY_PREFIX)) return Number(id.slice(TIER_KEY_PREFIX.length))
  for (const [tier, ids] of Object.entries(items)) if (ids.includes(id)) return Number(tier)
  return null
}

/**
 * The goal moved over another tier (or the empty body of one) while it is still being dragged: the
 * list shows it already there. Over a goal it takes that goal's place, over the tier itself the end.
 */
export function moveAcrossTiers(items: TierItems, activeId: string, overId: string): TierItems {
  const from = tierOfContainer(items, activeId)
  const to = tierOfContainer(items, overId)
  if (from === null || to === null || from === to) return items
  const target = items[to] ?? []
  const overIndex = target.indexOf(overId)
  const insertAt = overIndex === -1 ? target.length : overIndex
  return {
    ...items,
    [from]: (items[from] ?? []).filter((id) => id !== activeId),
    [to]: [...target.slice(0, insertAt), activeId, ...target.slice(insertAt)],
  }
}

/** Where the drop leaves the goal: its tier and 1-based position, after same-tier reordering. */
export function settleDrop(items: TierItems, activeId: string, overId: string): { items: TierItems; tier: number; position: number } | null {
  const tier = tierOfContainer(items, activeId)
  if (tier === null) return null
  const ids = items[tier] ?? []
  const from = ids.indexOf(activeId)
  const overIndex = ids.indexOf(overId)
  const to = overIndex === -1 ? from : overIndex
  const next = from === to ? ids : arrayMove(ids, from, to)
  return { items: { ...items, [tier]: next }, tier, position: next.indexOf(activeId) + 1 }
}
