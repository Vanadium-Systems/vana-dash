import { useRef } from 'react'
import type { Note } from '@/shared/lib/types'
import { NoteCard } from './NoteCard'
import { useMasonry } from './masonry'
import type { NotesView } from './notes-api'

type CardHandlers = Omit<React.ComponentProps<typeof NoteCard>, 'note' | 'slot' | 'ready' | 'measure' | 'selected' | 'view' | 'query' | 'selecting'>

interface NoteGridProps extends CardHandlers {
  notes: Note[]
  view: NotesView
  query: string
  selectedIds: Set<string>
  selecting: boolean
}

/** One masonry block: cards 240px wide, as many columns as fit, two fluid ones on a phone. */
export function NoteGrid({ notes, view, query, selectedIds, selecting, ...handlers }: NoteGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const ids = notes.map((note) => note.id)
  const { measure, position, height, ready } = useMasonry(ids, containerRef)
  return (
    <div ref={containerRef} className="relative w-full" style={{ height }}>
      {notes.map((note, index) => (
        <NoteCard
          key={note.id}
          note={note}
          view={view}
          query={query}
          selected={selectedIds.has(note.id)}
          selecting={selecting}
          slot={position(index)}
          ready={ready}
          measure={measure(note.id)}
          {...handlers}
        />
      ))}
    </div>
  )
}
