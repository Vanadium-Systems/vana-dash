// The shared category palette (`--tag-1..8` in index.css). Stored as 1..8 on the server
// (archive_folders.color, notes.color); null = no color.
export const TAG_COLORS = [1, 2, 3, 4, 5, 6, 7, 8] as const
export type TagColor = (typeof TAG_COLORS)[number]

export const tagColor = (n: number) => `hsl(var(--tag-${n}))`
export const tagSurface = (n: number) => `hsl(var(--tag-${n}-surface))`

/** A person's colour, from their id: the same on every screen and device (chat, calendar). */
export function personTag(userId: string): TagColor {
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]!
}

/** An event colour as stored: `tag-<n>`, an older hex value, or null = its owner's colour. */
export function parseEventTag(color: string | null): TagColor | null {
  const match = color ? /^tag-([1-8])$/.exec(color) : null
  return match ? (Number(match[1]) as TagColor) : null
}

/** Background and text for a calendar event in both themes. */
export function eventColors(color: string | null, ownerUserId: string | null): { background: string; color: string } {
  const tag = parseEventTag(color) ?? (color ? null : ownerUserId ? personTag(ownerUserId) : 6)
  if (tag) return { background: tagColor(tag), color: 'hsl(var(--tag-on))' }
  // Hex from before the tag palette (and the fixed colour of recurring payments): white text, as it was.
  return { background: color!, color: '#fff' }
}
