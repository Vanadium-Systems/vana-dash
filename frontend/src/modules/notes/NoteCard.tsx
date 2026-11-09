import { Archive, ArchiveRestore, MoreVertical, Pin, Trash2, Undo2 } from 'lucide-react'
import { useRef, type CSSProperties } from 'react'
import { Highlight } from '@/shared/components/Highlight'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { DropdownMenu, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { t } from '@/shared/lib/i18n'
import { motionLevel } from '@/shared/lib/motion'
import { tagSurface } from '@/shared/lib/tag-colors'
import type { Note } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { NotePreview } from './NotePreview'
import { ColorMenu } from './NoteMenus'
import type { NotesView } from './notes-api'

// Where there is a mouse, a card's controls show on hover and on keyboard focus; on a phone nothing
// but the pin of a pinned note is drawn, a long press selects and a tap opens (N9, N31).
// Written out in full: Tailwind finds classes by scanning the source for whole strings.
const HOVER_ONLY = 'hidden [@media(hover:hover)_and_(pointer:fine)]:group-hover:flex [@media(hover:hover)_and_(pointer:fine)]:group-focus-within:flex'
const HOVER_ONLY_INLINE =
  'hidden [@media(hover:hover)_and_(pointer:fine)]:group-hover:inline-flex [@media(hover:hover)_and_(pointer:fine)]:group-focus-within:inline-flex'
const LONG_PRESS_MS = 450

interface NoteCardProps {
  note: Note
  view: NotesView
  query: string
  selected: boolean
  selecting: boolean
  slot: { x: number; y: number; width: number }
  ready: boolean
  measure: (node: HTMLElement | null) => void
  onOpen: (note: Note) => void
  onToggleSelect: (note: Note) => void
  onPin: (note: Note) => void
  onColor: (note: Note, color: number | null) => void
  onArchive: (note: Note) => void
  onUnarchive: (note: Note) => void
  onTrash: (note: Note) => void
  onRestore: (note: Note) => void
  onCopyLink: (note: Note) => void
}

export function NoteCard(props: NoteCardProps) {
  const { note, view, query, selected, selecting, slot, ready, measure } = props
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)

  const cancelPress = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  const startPress = () => {
    cancelPress()
    longPressed.current = false
    timer.current = setTimeout(() => {
      longPressed.current = true
      props.onToggleSelect(note)
    }, LONG_PRESS_MS)
  }

  const style: CSSProperties = {
    transform: `translate(${slot.x}px, ${slot.y}px)`,
    width: slot.width,
    ...(note.color ? { backgroundColor: tagSurface(note.color) } : {}),
  }
  const hasBody = note.body.trim().length > 0
  const shownLabels = note.labels.slice(0, 3)

  return (
    <article
      ref={measure}
      data-note-id={note.id}
      style={style}
      className={cn(
        'group absolute left-0 top-0 rounded-lg border bg-card text-card-foreground',
        // The slide to a new place is the FLIP of pin / archive / restore (N10); not on first layout, not under reduced motion.
        ready && motionLevel() === 'full' && 'transition-transform duration-standard ease-out-strong',
        selected && 'ring-2 ring-primary',
        !ready && 'invisible',
      )}
    >
      <button
        type="button"
        className="block w-full rounded-lg p-3 pb-10 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={(e) => {
          if (longPressed.current) {
            longPressed.current = false
            return
          }
          if (selecting || e.ctrlKey || e.metaKey || e.shiftKey) props.onToggleSelect(note)
          else props.onOpen(note)
        }}
        onTouchStart={startPress}
        onTouchMove={cancelPress}
        onTouchEnd={cancelPress}
        onTouchCancel={cancelPress}
        onContextMenu={(e) => {
          // The long press would open the browser's menu on top of the selection.
          if (longPressed.current) e.preventDefault()
        }}
      >
        {note.title ? (
          <h3 className="line-clamp-2 pr-6 text-sm font-semibold leading-snug">
            <Highlight text={note.title} query={query} />
          </h3>
        ) : null}
        {hasBody || note.bodyJson ? <NotePreview note={note} query={query} clamp className={cn(note.title && 'mt-2')} /> : null}
        {shownLabels.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1">
            {shownLabels.map((label) => (
              <li key={label} className="max-w-full truncate rounded-full border bg-background/60 px-2 text-xs">
                {label}
              </li>
            ))}
            {note.labels.length > shownLabels.length ? <li className="rounded-full px-1 text-xs text-muted-foreground">+{note.labels.length - shownLabels.length}</li> : null}
          </ul>
        ) : null}
      </button>

      <div className={cn('absolute left-2 top-2 items-center rounded bg-background/80 p-0.5', selecting || selected ? 'flex' : HOVER_ONLY)}>
        <Checkbox checked={selected} onChange={() => props.onToggleSelect(note)} aria-label={t('notes:select')} />
      </div>

      {view !== 'trash' ? (
        <button
          type="button"
          title={note.pinned ? t('notes:unpin') : t('notes:pin')}
          aria-label={note.pinned ? t('notes:unpin') : t('notes:pin')}
          aria-pressed={note.pinned}
          onClick={() => props.onPin(note)}
          className={cn(
            'absolute right-1.5 top-1.5 h-control-sm w-control-sm items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            note.pinned ? 'inline-flex' : HOVER_ONLY_INLINE,
          )}
        >
          <Pin className={cn('h-4 w-4', note.pinned && 'fill-current')} aria-hidden="true" />
        </button>
      ) : null}

      <div className={cn('absolute inset-x-1 bottom-1 items-center gap-0.5', HOVER_ONLY)}>
        {view === 'trash' ? (
          <button
            type="button"
            title={t('notes:restore')}
            aria-label={t('notes:restore')}
            onClick={() => props.onRestore(note)}
            className="inline-flex h-control-sm w-control-sm items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Undo2 className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <>
            <ColorMenu value={note.color} onChange={(color) => props.onColor(note, color)} />
            <button
              type="button"
              title={view === 'archived' ? t('notes:unarchive') : t('notes:archive')}
              aria-label={view === 'archived' ? t('notes:unarchive') : t('notes:archive')}
              onClick={() => (view === 'archived' ? props.onUnarchive(note) : props.onArchive(note))}
              className="inline-flex h-control-sm w-control-sm items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {view === 'archived' ? <ArchiveRestore className="h-4 w-4" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-control-sm w-control-sm items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <MoreVertical className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{t('common:labels.actions')}</span>
              </DropdownMenuTrigger>
              <ResponsiveMenuContent title={note.title || t('notes:untitled')}>
                <DropdownMenuItem onClick={() => props.onCopyLink(note)}>{t('notes:copyLink')}</DropdownMenuItem>
                <DropdownMenuItem destructive onClick={() => props.onTrash(note)}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" /> {t('notes:moveToTrash')}
                </DropdownMenuItem>
              </ResponsiveMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </article>
  )
}
