// @vitest-environment jsdom
import { Editor } from '@tiptap/react'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeHref, noteExtensions } from './note-extensions'
import { filterSlashItems } from './slash-command'

let editor: Editor | null = null
afterEach(() => editor?.destroy())

function makeEditor() {
  editor = new Editor({ element: document.createElement('div'), extensions: noteExtensions({ placeholder: '' }), content: { type: 'doc', content: [{ type: 'paragraph' }] } })
  return editor
}

// Types like a keyboard does: input rules hook `handleTextInput`, which `insertText` bypasses.
function type(e: Editor, text: string) {
  for (const char of text) {
    const { from, to } = e.state.selection
    const handled = e.view.someProp('handleTextInput', (handler) => handler(e.view, from, to, char, () => e.state.tr.insertText(char, from, to)))
    if (!handled) e.view.dispatch(e.state.tr.insertText(char, from, to))
  }
}

const firstNode = (e: Editor) => e.getJSON().content?.[0]

describe('markdown on typing (decision 5)', () => {
  it.each([
    ['# ', 'heading', 1],
    ['## ', 'heading', 2],
    ['- ', 'bulletList', undefined],
    ['1. ', 'orderedList', undefined],
    ['[] ', 'taskList', undefined],
    ['> ', 'blockquote', undefined],
    ['``` ', 'codeBlock', undefined],
  ])('"%s" starts a %s', (typed, nodeType, level) => {
    const e = makeEditor()
    type(e, typed)
    const node = firstNode(e)
    expect(node?.type).toBe(nodeType)
    if (level) expect(node?.attrs?.level).toBe(level)
  })

  it('**x** makes bold and _x_ makes italic', () => {
    const e = makeEditor()
    type(e, '**strong**')
    expect(firstNode(e)?.content?.[0]).toMatchObject({ text: 'strong', marks: [{ type: 'bold' }] })
    const f = makeEditor()
    type(f, '_slanted_')
    expect(firstNode(f)?.content?.[0]).toMatchObject({ text: 'slanted', marks: [{ type: 'italic' }] })
  })
})

describe('slash menu items', () => {
  it('filters by the label, ignoring case and diacritics', () => {
    expect(filterSlashItems('LISTA').map((item) => item.key).sort()).toEqual(['bullet', 'ordered', 'task'].sort())
    expect(filterSlashItems('zzz')).toEqual([])
    expect(filterSlashItems('')).toHaveLength(9)
  })
})

describe('link targets', () => {
  it('accepts http(s) and mailto, adds https to a bare domain, refuses other schemes', () => {
    expect(normalizeHref('example.com')).toBe('https://example.com')
    expect(normalizeHref('http://example.com/a')).toBe('http://example.com/a')
    expect(normalizeHref('mailto:a@example.com')).toBe('mailto:a@example.com')
    expect(normalizeHref('javascript:alert(1)')).toBeNull()
    expect(normalizeHref('  ')).toBeNull()
  })
})
