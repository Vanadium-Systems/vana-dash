// The shared category palette (`--tag-1..8` in index.css). Stored as 1..8 on the server
// (archive_folders.color, notes.color); null = no color.
export const TAG_COLORS = [1, 2, 3, 4, 5, 6, 7, 8] as const
export type TagColor = (typeof TAG_COLORS)[number]

export const tagColor = (n: number) => `hsl(var(--tag-${n}))`
export const tagSurface = (n: number) => `hsl(var(--tag-${n}-surface))`
