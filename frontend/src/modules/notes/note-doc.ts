import type { Note, NoteDoc, NoteNode } from '@/shared/lib/types'

// An old note has only plain text. Opened in the editor it becomes one paragraph per line, so no
// line break is lost; the first save sends the document and the note turns rich.
export function plainToDoc(body: string): NoteDoc {
  if (!body) return { type: 'doc', content: [{ type: 'paragraph' }] }
  return {
    type: 'doc',
    content: body.split('\n').map((line): NoteNode => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })),
  }
}

export function noteToDoc(note: Pick<Note, 'bodyJson' | 'body'>): NoteDoc {
  return note.bodyJson ?? plainToDoc(note.body)
}

function hasText(node: NoteNode): boolean {
  if (node.text?.trim()) return true
  return node.content?.some(hasText) ?? false
}

/** A note with no title and no text anywhere in the body is not worth keeping. */
export function isEmptyNote(title: string, doc: NoteDoc | null): boolean {
  return !title.trim() && !(doc?.content?.some(hasText) ?? false)
}

/** An empty task list, for the bar's "List" button: the first item is ready to type in. */
export const EMPTY_TASK_DOC: NoteDoc = {
  type: 'doc',
  content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] }] }],
}
