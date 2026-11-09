import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, History, Link2, MessageSquareShare, MoreVertical, Pin, Tag, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/shared/components/ui/dialog'
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { useMinuteTick } from '@/shared/hooks/use-minute-tick'
import { api, ApiError } from '@/shared/lib/api'
import { formatListDate } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import { tagSurface } from '@/shared/lib/tag-colors'
import type { Note, NoteDoc } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { EMPTY_TASK_DOC, isEmptyNote, noteToDoc, plainToDoc } from './note-doc'
import { createNoteSaver, type NoteDraft, type SaveStatus } from './note-saver'
import { NoteEditor } from './NoteEditor'
import { LabelsField } from './LabelsField'
import { ColorMenu } from './NoteMenus'
import { noteDetailKey, useNoteActions, type LabelCount } from './notes-api'

export const NEW_NOTE = 'new'
export const NEW_LIST = 'new-list'

export interface NoteDialogActions {
  share: (note: Note) => void
  openVersions: (note: Note) => void
  copyLink: (note: Note) => void
}

interface NoteDialogProps {
  /** A note id, or `NEW_NOTE` / `NEW_LIST`. Null = closed. */
  target: string | null
  labels: LabelCount[]
  canShare: boolean
  actions: NoteDialogActions
  onClose: () => void
}

export function NoteDialog({ target, labels, canShare, actions, onClose }: NoteDialogProps) {
  const open = target !== null
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      {open ? <NoteDialogContent target={target} labels={labels} canShare={canShare} actions={actions} onClose={onClose} /> : null}
    </Dialog>
  )
}

function NoteDialogContent({ target, labels, canShare, actions, onClose }: Omit<NoteDialogProps, 'target'> & { target: string }) {
  const isNew = target === NEW_NOTE || target === NEW_LIST
  const queryClient = useQueryClient()
  const detail = useQuery({
    queryKey: noteDetailKey(target),
    queryFn: () => api.get<Note>(`/api/notes/${target}`),
    enabled: !isNew,
    retry: false,
  })
  // The note the editor was mounted from. Later refetches (a color change, say) must not remount it
  // under the cursor, so the editor keeps this one until a reload or a restored version replaces it.
  const [base, setBase] = useState<Note | null>(null)
  const [mountKey, setMountKey] = useState(0)

  useEffect(() => {
    if (detail.data && !base) setBase(detail.data)
  }, [detail.data, base])

  useEffect(() => {
    if (!detail.isError) return
    const gone = detail.error instanceof ApiError && detail.error.status === 404
    toast.error(gone ? t('notes:notFound') : detail.error.message)
    onClose()
  }, [detail.isError])

  const reload = useCallback(
    (note: Note) => {
      queryClient.setQueryData(noteDetailKey(note.id), note)
      setBase(note)
      setMountKey((key) => key + 1)
    },
    [queryClient],
  )

  const ready = isNew || base !== null
  return (
    <DialogContent
      aria-describedby={undefined}
      className={cn('flex flex-col gap-0 p-0 md:max-w-[45rem] md:p-0', 'max-md:rounded-none max-md:border-0')}
      style={base?.color ? { backgroundColor: tagSurface(base.color) } : undefined}
      onOpenAutoFocus={(e) => {
        // An existing note is opened to be read; the keyboard (on a phone) stays down until a tap.
        if (!isNew) e.preventDefault()
      }}
      onEscapeKeyDown={(e) => {
        // Esc closes the "/" menu or the link field first, not the whole note.
        const inLocalPopup = e.target instanceof HTMLElement && e.target.closest('[data-esc-local]')
        if (inLocalPopup || document.querySelector('[data-note-slash]')) e.preventDefault()
      }}
    >
      <DialogTitle className="sr-only">{isNew ? t('notes:newNote') : t('notes:editTitle')}</DialogTitle>
      {ready ? (
        <NoteSession
          key={`${base?.id ?? target}:${mountKey}`}
          initial={base}
          list={target === NEW_LIST}
          labels={labels}
          canShare={canShare}
          actions={actions}
          onReload={reload}
          onClose={onClose}
        />
      ) : (
        <div className="space-y-3 p-6">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
    </DialogContent>
  )
}

interface NoteSessionProps {
  initial: Note | null
  list: boolean
  labels: LabelCount[]
  canShare: boolean
  actions: NoteDialogActions
  onReload: (note: Note) => void
  onClose: () => void
}

function NoteSession({ initial, list, labels, canShare, actions, onReload, onClose }: NoteSessionProps) {
  const queryClient = useQueryClient()
  const noteActions = useNoteActions()
  const idRef = useRef(initial?.id ?? null)
  const readOnly = Boolean(initial?.deletedAt)
  const startDoc = useMemo<NoteDoc>(() => (initial ? noteToDoc(initial) : list ? EMPTY_TASK_DOC : plainToDoc('')), [initial, list])
  const draftRef = useRef<NoteDraft>({ title: initial?.title ?? '', doc: startDoc })
  const [title, setTitle] = useState(initial?.title ?? '')
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [conflict, setConflict] = useState<Note | null>(null)
  const [editedAt, setEditedAt] = useState(initial?.updatedAt ?? null)
  const [addingLabel, setAddingLabel] = useState(false)
  const editorFocus = useRef<() => void>(() => {})
  useMinuteTick()

  // Colors, labels, pin and archive come from the live copy of the note (they change through
  // their own routes), the text from the editor.
  const live = useQuery({
    queryKey: noteDetailKey(idRef.current ?? 'new'),
    queryFn: () => api.get<Note>(`/api/notes/${idRef.current}`),
    enabled: false,
    initialData: initial ?? undefined,
  })
  const meta = live.data ?? initial

  const saver = useMemo(
    () =>
      createNoteSaver({
        send: async (draft, expectedUpdatedAt) => {
          if (idRef.current) {
            return api.patch<Note>(`/api/notes/${idRef.current}`, { title: draft.title, bodyJson: draft.doc, expectedUpdatedAt })
          }
          // A new note exists only once it has something in it (N26).
          if (isEmptyNote(draft.title, draft.doc)) return null
          const created = await api.post<Note>('/api/notes', { title: draft.title, bodyJson: draft.doc })
          idRef.current = created.id
          queryClient.setQueryData(noteDetailKey(created.id), created)
          return created
        },
        onSaved: (saved) => {
          setEditedAt(saved.updatedAt)
          void queryClient.invalidateQueries({ queryKey: ['notes', 'list'] })
        },
        onStatus: setStatus,
        onConflict: setConflict,
      }),
    [queryClient],
  )

  useEffect(() => {
    if (initial) saver.setBase(initial.updatedAt)
  }, [initial, saver])

  // Whatever closes the note (button, Esc, browser Back, a link elsewhere) ends here. The cleanup is
  // deferred a tick: React's dev double-mount runs it right after mounting, and that is not a close.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      queueMicrotask(() => {
        if (mounted.current) return
        saver.dispose()
        if (!idRef.current && isEmptyNote(draftRef.current.title, draftRef.current.doc)) {
          toast(t('notes:emptyDiscarded'))
          return
        }
        void saver.flush().then(() => queryClient.invalidateQueries({ queryKey: ['notes'] }))
      })
    }
  }, [saver, queryClient])

  const push = (next: Partial<NoteDraft>) => {
    draftRef.current = { ...draftRef.current, ...next }
    if (!readOnly) saver.change(draftRef.current)
  }

  const note = meta
  const statusText =
    status === 'saving'
      ? t('notes:status.saving')
      : status === 'error'
        ? t('notes:status.error')
        : editedAt
          ? isJustNow(editedAt)
            ? t('notes:status.editedNow')
            : t('notes:status.editedAt', { time: formatListDate(editedAt) })
          : ''

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {readOnly && initial ? (
        <Banner tone="info">
          <span>{t('notes:trashBanner')}</span>
          <Button size="sm" onClick={() => void noteActions.restore([initial]).then(() => onClose())}>
            {t('notes:restore')}
          </Button>
        </Banner>
      ) : null}
      {conflict ? (
        <Banner tone="warning">
          <span>{t('notes:conflict.message')}</span>
          <span className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                saver.discard(conflict.updatedAt)
                onReload(conflict)
                setConflict(null)
              }}
            >
              {t('notes:conflict.reload')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                saver.keepMine(conflict.updatedAt)
                setConflict(null)
              }}
            >
              {t('notes:conflict.keepMine')}
            </Button>
          </span>
        </Banner>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-12 md:px-6 md:pt-8">
        <input
          value={title}
          readOnly={readOnly}
          onChange={(e) => {
            setTitle(e.target.value)
            push({ title: e.target.value })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              editorFocus.current()
            }
          }}
          maxLength={255}
          placeholder={t('notes:titlePlaceholder')}
          aria-label={t('notes:titlePlaceholder')}
          className="mb-3 w-full bg-transparent text-xl font-semibold outline-none placeholder:text-muted-foreground"
        />
        <NoteEditor
          doc={startDoc}
          editable={!readOnly}
          autoFocus={!initial}
          onChange={(doc) => push({ doc })}
          onSubmit={onClose}
          className="min-h-40"
        />
        {note ? <LabelsField note={note} labels={labels} readOnly={readOnly} adding={addingLabel} onAddingChange={setAddingLabel} /> : null}
      </div>

      <div className="flex items-center gap-1 border-t px-3 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
        <span className="tnum min-w-0 flex-1 truncate text-xs text-muted-foreground" aria-live="polite">
          {statusText}
        </span>
        {note && !readOnly ? (
          <>
            <ColorMenu value={note.color} align="end" onChange={(color) => void noteActions.setColor([note], color)} />
            <Button variant="ghost" size="icon-sm" title={t('notes:label.add')} aria-label={t('notes:label.add')} onClick={() => setAddingLabel(true)}>
              <Tag />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title={note.pinned ? t('notes:unpin') : t('notes:pin')}
              aria-label={note.pinned ? t('notes:unpin') : t('notes:pin')}
              aria-pressed={note.pinned}
              onClick={() => void noteActions.pin([note], !note.pinned)}
            >
              <Pin className={cn(note.pinned && 'fill-current')} />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title={note.archivedAt ? t('notes:unarchive') : t('notes:archive')}
              aria-label={note.archivedAt ? t('notes:unarchive') : t('notes:archive')}
              onClick={() => void (note.archivedAt ? noteActions.unarchive([note]) : noteActions.archive([note])).then(() => onClose())}
            >
              {note.archivedAt ? <ArchiveRestore /> : <Archive />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex h-control-sm w-control-sm items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <MoreVertical className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{t('common:labels.actions')}</span>
              </DropdownMenuTrigger>
              <ResponsiveMenuContent title={title || t('notes:untitled')} align="end">
                <DropdownMenuItem onClick={() => actions.openVersions(note)}>
                  <History className="h-4 w-4" aria-hidden="true" /> {t('notes:versions.action')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.copyLink(note)}>
                  <Link2 className="h-4 w-4" aria-hidden="true" /> {t('notes:copyLink')}
                </DropdownMenuItem>
                {canShare ? (
                  <DropdownMenuItem onClick={() => actions.share(note)}>
                    <MessageSquareShare className="h-4 w-4" aria-hidden="true" /> {t('messages:share.action')}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onClick={() => void noteActions.trash([note]).then(() => onClose())}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" /> {t('notes:moveToTrash')}
                </DropdownMenuItem>
              </ResponsiveMenuContent>
            </DropdownMenu>
          </>
        ) : null}
        <Button variant="outline" size="sm" onClick={onClose} className="ml-1">
          {t('notes:done')}
        </Button>
      </div>
    </div>
  )
}

function isJustNow(value: string): boolean {
  return Date.now() - new Date(value).getTime() < 60_000
}

function Banner({ tone, children }: { tone: 'info' | 'warning'; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 pr-12 text-sm',
        tone === 'warning' ? 'bg-warning/15' : 'bg-muted',
      )}
    >
      {children}
    </div>
  )
}
