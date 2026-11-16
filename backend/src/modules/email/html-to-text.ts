// Some senders (ANAF SPV, automated systems) send ONLY text/html without a text/plain
// alternative. We always render plain text (not sanitized HTML/iframe), so we convert once at ingest.

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ndash: '–',
  mdash: '—',
  hellip: '…',
  euro: '€',
  copy: '©',
  reg: '®',
  trade: '™',
  laquo: '«',
  raquo: '»',
}

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const cp = Number.parseInt(entity.slice(2), 16)
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : full
    }
    if (entity.startsWith('#')) {
      const cp = Number.parseInt(entity.slice(1), 10)
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : full
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? full
  })
}

export function htmlToPlainText(html: string): string {
  if (!html) return ''

  let out = html
    // Remove comments, head, script, and style blocks completely
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    // Skip images and horizontal rules (decorative lines clutter narrow chat bubbles)
    .replace(/<(img|hr)\b[^>]*\/?>/gi, '')
    // Convert links to "text (url)" when href is an external/mailto target different from text
    .replace(/<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))[^>]*>([\s\S]*?)<\/a>/gi, (_m, q1, q2, q3, inner: string) => {
      const href = (q1 ?? q2 ?? q3 ?? '').trim()
      const label = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      if (!label) return href
      if (!href || href.startsWith('#') || href === label) return label
      return `${label} (${href})`
    })
    // Line breaks and list items
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    // Table cells separated by space/tab
    .replace(/<\/(td|th)>/gi, ' ')
    // Block elements produce paragraph breaks
    .replace(/<\/?(p|div|h[1-6]|blockquote|tr|section|article|header|footer|ul|ol|table)\b[^>]*>/gi, '\n\n')
    // Strip remaining tags
    .replace(/<[^>]+>/g, '')

  out = decodeHtmlEntities(out)

  return out
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
