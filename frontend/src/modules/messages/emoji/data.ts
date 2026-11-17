// The emoji list is ~750 KB of JSON: loaded on first use (first `:xx` or first open of the picker),
// never in the initial bundle, and kept in memory afterwards.
export interface EmojiEntry {
  emoji: string
  label: string
  group: number
  /** Shortcodes without colons, e.g. `sob`, `loudly_crying_face`. */
  codes: string[]
  tags: string[]
}

interface CompactEmoji {
  unicode: string
  label: string
  group?: number
  order?: number
  tags?: string[]
  hexcode: string
}

// Group 2 is skin-tone swatches and hair components; emoji without a group are regional indicators.
const SKIPPED_GROUP = 2

let loading: Promise<EmojiEntry[]> | null = null

export function loadEmoji(): Promise<EmojiEntry[]> {
  loading ??= Promise.all([
    import('emojibase-data/en/compact.json'),
    import('emojibase-data/en/shortcodes/emojibase.json'),
  ]).then(([compact, shortcodes]) => {
    const codesByHex = shortcodes.default as Record<string, string | string[]>
    return (compact.default as CompactEmoji[])
      .filter((e) => e.group !== undefined && e.group !== SKIPPED_GROUP)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((e) => ({
        emoji: e.unicode,
        label: e.label,
        group: e.group as number,
        codes: [codesByHex[e.hexcode] ?? []].flat(),
        tags: e.tags ?? [],
      }))
  })
  // A failed load (offline) must not stick: the next attempt tries again.
  loading.catch(() => {
    loading = null
  })
  return loading
}

/** Shortcodes starting with the query first, then those that contain it. */
export function matchShortcodes(entries: EmojiEntry[], query: string, limit: number): EmojiEntry[] {
  const q = query.toLowerCase()
  const starts: EmojiEntry[] = []
  const contains: EmojiEntry[] = []
  for (const entry of entries) {
    if (starts.length >= limit) break
    if (entry.codes.some((c) => c.startsWith(q))) starts.push(entry)
    else if (contains.length < limit && entry.codes.some((c) => c.includes(q))) contains.push(entry)
  }
  return [...starts, ...contains].slice(0, limit)
}

/** Picker search: name, shortcode or keyword. */
export function searchEmoji(entries: EmojiEntry[], query: string): EmojiEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return entries
  return entries.filter((e) => e.label.includes(q) || e.codes.some((c) => c.includes(q)) || e.tags.some((tag) => tag.includes(q)))
}

export function findByShortcode(entries: EmojiEntry[], code: string): EmojiEntry | undefined {
  const c = code.toLowerCase()
  return entries.find((e) => e.codes.includes(c))
}

const OPEN = /(?:^|\s):([a-z0-9_+-]{2,})$/i
const CLOSED = /(?:^|\s)(:([a-z0-9_+-]{2,}):)$/i

/** `:text` right before the caret, at the start of a word; `start` is the index of the colon. */
export function openShortcode(textBeforeCaret: string): { query: string; start: number } | null {
  const m = OPEN.exec(textBeforeCaret)
  return m?.[1] ? { query: m[1], start: textBeforeCaret.length - m[1].length - 1 } : null
}

/** A finished `:code:` right before the caret. */
export function closedShortcode(textBeforeCaret: string): { code: string; start: number } | null {
  const m = CLOSED.exec(textBeforeCaret)
  return m?.[1] && m[2] ? { code: m[2], start: textBeforeCaret.length - m[1].length } : null
}
