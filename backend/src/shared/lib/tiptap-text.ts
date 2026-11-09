// Tiptap documents on the server without tiptap: notes keep their JSON for the editor, and the
// server derives the plain text that search, Ctrl K and message cards read.

export interface TiptapNode {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type?: string; attrs?: Record<string, unknown> }[]
  content?: TiptapNode[]
}

const MAX_DEPTH = 30
const MAX_BYTES = 1024 * 1024
const SAFE_HREF = /^(https?:|mailto:|tel:)/i

export class TiptapDocError extends Error {}

const BLOCKS = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem', 'taskItem', 'horizontalRule'])

function walk(node: TiptapNode, out: string[], listPrefix: string) {
  if (node.type === 'text') {
    out.push(node.text ?? '')
    return
  }
  if (node.type === 'hardBreak') {
    out.push('\n')
    return
  }
  if (node.type === 'taskItem') out.push(node.attrs?.checked ? '[x] ' : '[ ] ')
  else if (node.type === 'listItem') out.push(listPrefix)
  const childPrefix = node.type === 'orderedList' ? '1. ' : node.type === 'bulletList' ? '- ' : listPrefix
  for (const child of node.content ?? []) walk(child, out, childPrefix)
  if (node.type && BLOCKS.has(node.type)) out.push('\n')
}

/** Plain text of a document: one line per block, list items with "- ", tasks with "[ ] "/"[x] ". */
export function tiptapToText(doc: TiptapNode): string {
  const out: string[] = []
  walk(doc, out, '- ')
  return out
    .join('')
    .split('\n')
    .map(trimTrailingBlanks)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// A loop, not /[ \t]+\n/: that regex goes quadratic on a long run of tabs (CodeQL js/polynomial-redos).
function trimTrailingBlanks(line: string): string {
  let end = line.length
  while (end > 0 && (line[end - 1] === ' ' || line[end - 1] === '\t')) end--
  return line.slice(0, end)
}

function check(node: unknown, depth: number): TiptapNode {
  if (depth > MAX_DEPTH) throw new TiptapDocError('document too deep')
  if (typeof node !== 'object' || node === null || Array.isArray(node)) throw new TiptapDocError('node is not an object')
  const n = node as TiptapNode
  if (typeof n.type !== 'string') throw new TiptapDocError('node without type')
  if (n.text !== undefined && typeof n.text !== 'string') throw new TiptapDocError('text is not a string')
  const marks = Array.isArray(n.marks)
    ? n.marks.filter((m) => !(m?.type === 'link' && !SAFE_HREF.test(String(m.attrs?.href ?? ''))))
    : undefined
  const content = n.content === undefined ? undefined : Array.isArray(n.content) ? n.content.map((c) => check(c, depth + 1)) : null
  if (content === null) throw new TiptapDocError('content is not an array')
  return { ...n, ...(marks ? { marks } : {}), ...(content ? { content } : {}) }
}

/**
 * Checks the shape and size of a document and drops link marks whose href is not http(s),
 * mailto or tel (a `javascript:` link would run in the editor of whoever opens the note).
 */
export function sanitizeTiptapDoc(doc: unknown): TiptapNode {
  if (Buffer.byteLength(JSON.stringify(doc ?? null), 'utf8') > MAX_BYTES) throw new TiptapDocError('document too large')
  const clean = check(doc, 0)
  if (clean.type !== 'doc') throw new TiptapDocError('root is not a doc')
  return clean
}

/** A document with one paragraph per line, for plain text written into a rich note. */
export function plainToTiptapDoc(text: string): TiptapNode {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })),
  }
}
