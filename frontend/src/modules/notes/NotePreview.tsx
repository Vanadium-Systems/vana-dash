import { Fragment, type ReactNode } from 'react'
import { Highlight } from '@/shared/components/Highlight'
import type { NoteNode } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { noteToDoc } from './note-doc'
import './note-editor.css'
import type { Note } from '@/shared/lib/types'

// Read-only rendering of a note's document, without tiptap: the grid draws a card per note, and
// an editor instance per card would be hundreds of them. Styles are the editor's (`note-prose`).
// Only the marks the editor can produce are drawn; a link is plain text here, because the card
// itself is the click target.

function renderText(node: NoteNode, query: string): ReactNode {
  let out: ReactNode = <Highlight text={node.text ?? ''} query={query} />
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') out = <strong>{out}</strong>
    else if (mark.type === 'italic') out = <em>{out}</em>
    else if (mark.type === 'underline') out = <u>{out}</u>
    else if (mark.type === 'code') out = <code>{out}</code>
    else if (mark.type === 'strike') out = <s>{out}</s>
    else if (mark.type === 'link') out = <span className="text-primary underline">{out}</span>
  }
  return out
}

function renderChildren(nodes: NoteNode[] | undefined, query: string): ReactNode {
  return nodes?.map((child, i) => <Fragment key={i}>{renderNode(child, query)}</Fragment>)
}

function renderNode(node: NoteNode, query: string): ReactNode {
  const children = renderChildren(node.content, query)
  switch (node.type) {
    case 'text':
      return renderText(node, query)
    case 'hardBreak':
      return <br />
    case 'paragraph':
      return <p className={node.content ? undefined : 'h-6'}>{children}</p>
    case 'heading': {
      const level = Math.min(3, Math.max(1, Number(node.attrs?.level ?? 1)))
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3'
      return <Tag>{children}</Tag>
    }
    case 'bulletList':
      return <ul>{children}</ul>
    case 'orderedList':
      return <ol>{children}</ol>
    case 'listItem':
      return <li>{children}</li>
    case 'taskList':
      return <ul data-type="taskList">{children}</ul>
    case 'taskItem':
      return (
        <li data-checked={node.attrs?.checked ? 'true' : 'false'}>
          <label>
            <input type="checkbox" checked={Boolean(node.attrs?.checked)} readOnly tabIndex={-1} aria-hidden="true" className="pointer-events-none" />
          </label>
          <div>{children}</div>
        </li>
      )
    case 'blockquote':
      return <blockquote>{children}</blockquote>
    case 'codeBlock':
      return (
        <pre>
          <code>{children}</code>
        </pre>
      )
    case 'horizontalRule':
      return <hr />
    default:
      return children
  }
}

/** `clamp` cuts a card at about 20 lines; the overflow is simply hidden. */
export function NotePreview({ note, query = '', clamp, className }: { note: Pick<Note, 'bodyJson' | 'body'>; query?: string; clamp?: boolean; className?: string }) {
  const doc = noteToDoc(note)
  return (
    <div className={cn('note-prose', clamp && 'max-h-[30rem] overflow-hidden', className)}>{renderChildren(doc.content, query)}</div>
  )
}
