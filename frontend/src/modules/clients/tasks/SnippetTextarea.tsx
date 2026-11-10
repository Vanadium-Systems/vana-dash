import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Textarea, type TextareaProps } from '@/shared/components/ui/textarea'
import { cn, normalizeForSearch } from '@/shared/lib/utils'
import { useSnippets } from './use-tasks-data'

const MAX_SHOWN = 6

/** The `/word` being typed right before the caret; a slash inside a word (a URL, "and/or") is not a trigger. */
function slashToken(value: string, caret: number): { start: number; query: string } | null {
  const match = /(^|\s)\/([^\s/]*)$/.exec(value.slice(0, caret))
  return match ? { start: match.index + match[1]!.length, query: match[2]! } : null
}

type Props = Omit<TextareaProps, 'value' | 'onChange'> & { value: string; onValueChange: (value: string) => void }

/** A textarea where `/` opens the saved snippets: type to narrow, ↑ ↓ to move, Enter or Tab to insert, Esc to close. */
export function SnippetTextarea({ value, onValueChange, onKeyDown, className, ...props }: Props) {
  const snippets = useSnippets()
  const listId = useId()
  const ref = useRef<HTMLTextAreaElement>(null)
  const pendingCaret = useRef<number | null>(null)
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<number | null>(null)

  const token = slashToken(value, caret)
  const needle = token ? normalizeForSearch(token.query) : ''
  const matches = token
    ? (snippets.data ?? []).filter((snippet) => normalizeForSearch(snippet.name).includes(needle)).slice(0, MAX_SHOWN)
    : []
  const open = token !== null && matches.length > 0 && dismissedAt !== token.start

  useEffect(() => setActive(0), [token?.query])
  // The caret can only move once React has put the inserted text in the field.
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return
    ref.current?.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  })

  const insert = (body: string) => {
    if (!token) return
    onValueChange(value.slice(0, token.start) + body + value.slice(caret))
    pendingCaret.current = token.start + body.length
    setCaret(pendingCaret.current)
  }

  return (
    <div className="relative">
      <Textarea
        {...props}
        ref={ref}
        value={value}
        className={className}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        onChange={(e) => {
          onValueChange(e.target.value)
          setCaret(e.target.selectionStart)
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((current) => (current + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length)
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              insert(matches[active]!.body)
              return
            }
            if (e.key === 'Escape') {
              // Esc closes the list, not the dialog or the call session around it.
              e.preventDefault()
              e.stopPropagation()
              setDismissedAt(token!.start)
              return
            }
          }
          onKeyDown?.(e)
        }}
      />
      {open ? (
        <ul id={listId} role="listbox" className="menu-pop glass absolute inset-x-0 top-full z-50 mt-1 rounded-md border p-1 text-card-foreground shadow-md">
          {matches.map((snippet, index) => (
            <li
              key={snippet.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              // mousedown, not click: a click would blur the field first and drop the caret position.
              onMouseDown={(e) => {
                e.preventDefault()
                insert(snippet.body)
              }}
              onMouseEnter={() => setActive(index)}
              className={cn('cursor-pointer rounded-sm px-2 py-1.5 text-sm', index === active && 'bg-accent text-accent-foreground')}
            >
              <span className="block truncate font-medium">/{snippet.name}</span>
              <span className="line-clamp-1 block text-xs text-muted-foreground">{snippet.body}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
