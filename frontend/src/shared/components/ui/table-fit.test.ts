import { describe, expect, it } from 'vitest'

// No table may scroll sideways on a phone (CLAUDE.md, Tables). A static check can't measure
// widths, but it catches the two ways that rule broke before: a table header with more columns
// than a phone holds, and a sideways scroll container added to "fix" one.
const sources = import.meta.glob<string>('/src/**/*.tsx', { query: '?raw', import: 'default', eager: true })

// Columns a 360px screen holds next to each other, counting a narrow checkbox or ⋯ column.
const MAX_PHONE_COLUMNS = 4
// An email's own HTML can be wider than any screen; it is scaled down first and scrolls only as a last resort.
const SIDEWAYS_SCROLL_ALLOWED = ['/src/modules/email/HtmlMessageBody.tsx']

describe('tables fit a phone', () => {
  it('shows at most four columns below md', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100)
    const tooWide: string[] = []
    for (const [path, source] of Object.entries(sources)) {
      for (const match of source.matchAll(/<TableHeader>([\s\S]*?)<\/TableHeader>/g)) {
        const heads = (match[1] ?? '').match(/<TableHead\b[^>]*>/g) ?? []
        const onPhone = heads.filter((head) => !head.includes('priority=') && !head.includes('hidden'))
        if (onPhone.length > MAX_PHONE_COLUMNS) {
          const line = source.slice(0, match.index).split('\n').length
          tooWide.push(`${path}:${line} has ${onPhone.length} columns on a phone; give the rest priority="md" or "lg"`)
        }
      }
    }
    expect(tooWide).toEqual([])
  })

  it('adds no sideways scroll container', () => {
    const scrolling = Object.entries(sources)
      .filter(([path]) => !path.endsWith('.test.tsx') && !SIDEWAYS_SCROLL_ALLOWED.includes(path))
      .filter(([, source]) => /overflow-x-(auto|scroll)/.test(source))
      .map(([path]) => path)
    expect(scrolling).toEqual([])
  })
})
