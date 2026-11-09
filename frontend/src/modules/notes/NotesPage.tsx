import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, CheckSquare, FilePlus, Pin, PinOff, Plus, Search, Tag, Trash2, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader } from '@/shared/components/PageHeader'
import { useShareToMessages } from '@/shared/components/ShareToMessagesDialog'
import { Button } from '@/shared/components/ui/button'
import { ColorPicker } from '@/shared/components/ui/color-picker'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/shared/components/ui/dropdown-menu'
import { FilterChip, FilterMenuTrigger } from '@/shared/components/ui/filter-chip'
import { EmptyState } from '@/shared/components/ui/empty-state'
import { Fab } from '@/shared/components/ui/fab'
import { Input } from '@/shared/components/ui/input'
import { SelectionBar } from '@/shared/components/ui/selection-bar'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/shared/components/ui/tabs'
import { useConsumeParam } from '@/shared/hooks/use-consume-param'
import { useDebounced } from '@/shared/hooks/use-debounced'
import { useMediaQuery } from '@/shared/hooks/use-media-query'
import { useSelection } from '@/shared/hooks/use-selection'
import { api } from '@/shared/lib/api'
import { linkFor } from '@/shared/lib/entity-links'
import { t } from '@/shared/lib/i18n'
import { tagColor } from '@/shared/lib/tag-colors'
import type { Note } from '@/shared/lib/types'
import { LabelManager } from './LabelManager'
import { NoteComposer } from './NoteComposer'
import { NEW_LIST, NEW_NOTE, NoteDialog } from './NoteDialog'
import { NoteGrid } from './NoteGrid'
import { ColorMenu, LabelMenu } from './NoteMenus'
import { fetchNotes, NOTE_LABELS_KEY, notesListKey, useNoteActions, type LabelCount, type NotesFilter, type NotesView } from './notes-api'
import { VersionsPeek } from './VersionsPeek'

const VIEWS: NotesView[] = ['active', 'archived', 'trash']

function useNotesFilter(): [NotesFilter, (patch: Partial<NotesFilter>) => void] {
  const [params, setParams] = useSearchParams()
  const view = (VIEWS.find((v) => v === params.get('view')) ?? 'active') as NotesView
  const filter: NotesFilter = { view, q: params.get('q') ?? '', label: params.get('label') ?? '', color: params.get('color') ?? '' }
  const update = useCallback(
    (patch: Partial<NotesFilter>) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          for (const [key, value] of Object.entries(patch)) {
            if (!value || (key === 'view' && value === 'active')) next.delete(key)
            else next.set(key, value)
          }
          return next
        },
        { replace: true },
      ),
    [setParams],
  )
  return [filter, update]
}

export function NotesPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const actions = useNoteActions()
  const { canShare, share, dialog: shareDialog } = useShareToMessages()
  const [searchParams, setSearchParams] = useSearchParams()
  const [filter, setFilter] = useNotesFilter()
  const desktop = useMediaQuery('(min-width: 768px)')
  const [search, setSearch] = useState(filter.q)
  const debouncedSearch = useDebounced(search.trim(), 250)
  const [managingLabels, setManagingLabels] = useState(false)

  useEffect(() => {
    if (debouncedSearch !== filter.q) setFilter({ q: debouncedSearch })
    // The URL is the source on load; this only pushes the typed value into it.
  }, [debouncedSearch])

  const notes = useQuery({ queryKey: notesListKey(filter), queryFn: () => fetchNotes(filter) })
  const archivedCount = useQuery({ queryKey: notesListKey({ view: 'archived', q: '', label: '', color: '' }), queryFn: () => fetchNotes({ view: 'archived', q: '', label: '', color: '' }), select: (list) => list.length })
  const trashCount = useQuery({ queryKey: notesListKey({ view: 'trash', q: '', label: '', color: '' }), queryFn: () => fetchNotes({ view: 'trash', q: '', label: '', color: '' }), select: (list) => list.length })
  const labelsQuery = useQuery({ queryKey: NOTE_LABELS_KEY, queryFn: () => api.get<LabelCount[]>('/api/notes/labels') })
  const labels = labelsQuery.data ?? []

  const list = notes.data ?? []
  const pinned = filter.view === 'active' ? list.filter((note) => note.pinned) : []
  const others = filter.view === 'active' ? list.filter((note) => !note.pinned) : list
  const orderedIds = useMemo(() => [...pinned, ...others].map((note) => note.id), [pinned, others])
  const selection = useSelection(orderedIds)
  const selectedNotes = list.filter((note) => selection.isSelected(note.id))
  const hasFilter = Boolean(filter.q || filter.label || filter.color)

  // The open note lives in the URL (N6). Opening pushes an entry, so Back closes the note; closing
  // pops it when we pushed it, and just removes the param when the page was loaded with it.
  const openedByPush = useRef(false)
  const openTarget = searchParams.get('note')
  const peekNoteId = searchParams.get('versions')
  const setParam = useCallback(
    (patch: Record<string, string | null>, replace: boolean) =>
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          for (const [key, value] of Object.entries(patch)) {
            if (value === null) next.delete(key)
            else next.set(key, value)
          }
          return next
        },
        { replace },
      ),
    [setSearchParams],
  )
  const openNote = (id: string) => {
    openedByPush.current = true
    setParam({ note: id }, false)
  }
  const closeNote = useCallback(() => {
    if (openedByPush.current) {
      openedByPush.current = false
      navigate(-1)
    } else setParam({ note: null }, true)
  }, [navigate, setParam])
  useConsumeParam('new', () => openNote(NEW_NOTE))

  const copyLink = (note: Note) => {
    void navigator.clipboard.writeText(`${window.location.origin}${linkFor('note', note.id)}`).then(() => toast(t('common:states.copied')))
  }

  const emptyTrash = useMutation({
    mutationFn: () => api.delete('/api/notes/trash'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notes'] }),
    onError: (err) => toast.error(err.message),
  })
  const askEmptyTrash = () =>
    void confirm({
      title: t('notes:trash.emptyTitle'),
      consequence: t('notes:trash.emptyConsequence', { count: list.length }),
      confirmLabel: t('notes:trash.empty'),
      destructive: true,
    }).then((ok) => ok && emptyTrash.mutate())

  const cardHandlers = {
    onOpen: (note: Note) => openNote(note.id),
    onToggleSelect: (note: Note) => selection.toggle(note.id),
    onPin: (note: Note) => void actions.pin([note], !note.pinned),
    onColor: (note: Note, color: number | null) => void actions.setColor([note], color),
    onArchive: (note: Note) => void actions.archive([note]),
    onUnarchive: (note: Note) => void actions.unarchive([note]),
    onTrash: (note: Note) => void actions.trash([note]),
    onRestore: (note: Note) => void actions.restore([note]),
    onCopyLink: copyLink,
  }
  const gridProps = { view: filter.view, query: filter.q, selectedIds: selection.selected, selecting: selection.count > 0, ...cardHandlers }

  const done = () => selection.clear()
  const selectionActions = (
    <>
      {filter.view === 'active' ? (
        <>
          <Button variant="ghost" size="sm" onClick={() => void actions.pin(selectedNotes, !selectedNotes.every((note) => note.pinned)).then(done)}>
            {selectedNotes.every((note) => note.pinned) ? <PinOff /> : <Pin />}
            {selectedNotes.every((note) => note.pinned) ? t('notes:unpin') : t('notes:pin')}
          </Button>
          <ColorMenu value={null} label={t('notes:color')} onChange={(color) => void actions.setColor(selectedNotes, color).then(done)} />
          <LabelMenu labels={labels} onPick={(label) => void actions.addLabel(selectedNotes, label).then(done)} />
        </>
      ) : null}
      {filter.view === 'trash' ? (
        <Button variant="ghost" size="sm" onClick={() => void actions.restore(selectedNotes).then(done)}>
          <Undo2 /> {t('notes:restore')}
        </Button>
      ) : (
        <>
          <Button variant="ghost" size="sm" onClick={() => void (filter.view === 'archived' ? actions.unarchive(selectedNotes) : actions.archive(selectedNotes)).then(done)}>
            <Archive /> {filter.view === 'archived' ? t('notes:unarchive') : t('notes:archive')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void actions.trash(selectedNotes).then(done)}>
            <Trash2 /> {t('common:actions.delete')}
          </Button>
        </>
      )}
    </>
  )

  const filterChips = (
    <>
      {filter.label ? (
        <FilterChip label={filter.label} onRemove={() => setFilter({ label: '' })} />
      ) : null}
      {filter.color ? (
        <FilterChip
          label={t(`common:tagColors.${filter.color}` as 'common:tagColors.1')}
          swatch={tagColor(Number(filter.color))}
          onRemove={() => setFilter({ color: '' })}
        />
      ) : null}
    </>
  )

  const newTab = (view: NotesView) => (view === 'archived' ? archivedCount.data : view === 'trash' ? trashCount.data : undefined)

  return (
    <div className="space-y-4" data-density="comfortable">
      <PageHeader title={t('common:nav.notes')} />

      <div className="flex flex-wrap items-center gap-2">
        {selection.count > 0 && desktop ? (
          <div className="min-w-0 flex-1">
            <SelectionBar
              placement="toolbar"
              count={selection.count}
              allSelected={selection.allSelected}
              onSelectAll={selection.selectAll}
              onClear={selection.clear}
            >
              {selectionActions}
            </SelectionBar>
          </div>
        ) : (
          <>
            <Tabs value={filter.view} onValueChange={(view) => setFilter({ view: view as NotesView })}>
              <TabsList variant="segmented">
                {VIEWS.map((view) => (
                  <TabsTrigger key={view} value={view}>
                    {t(`notes:views.${view}` as 'notes:views.active')}
                    {newTab(view) ? <span className="tnum ml-1.5 text-xs text-muted-foreground">{newTab(view)}</span> : null}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="relative ml-auto w-full min-w-0 sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                placeholder={t('notes:searchPlaceholder')}
                aria-label={t('notes:searchPlaceholder')}
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <DropdownMenu>
              <FilterMenuTrigger />
              <DropdownMenuContent align="end">
                {labels.map((label) => (
                  <DropdownMenuItem key={label.name} onClick={() => setFilter({ label: label.name })}>
                    <Tag className="h-4 w-4" aria-hidden="true" /> {label.name}
                    <span className="tnum ml-auto text-xs text-muted-foreground">{label.count}</span>
                  </DropdownMenuItem>
                ))}
                {labels.length > 0 ? <DropdownMenuSeparator /> : null}
                <div className="p-2">
                  <ColorPicker value={filter.color ? Number(filter.color) : null} onChange={(color) => setFilter({ color: color === null ? '' : String(color) })} />
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setManagingLabels(true)}>{t('notes:label.manage')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      {filterChips ? <div className="flex flex-wrap gap-2 empty:hidden">{filterChips}</div> : null}

      {filter.view === 'active' ? <NoteComposer /> : null}

      {filter.view === 'trash' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm">
          <span>{t('notes:trash.hint')}</span>
          {list.length > 0 ? (
            <Button variant="outline" size="sm" onClick={askEmptyTrash} disabled={emptyTrash.isPending}>
              {t('notes:trash.empty')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {notes.isPending ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : list.length === 0 ? (
        hasFilter ? (
          <EmptyState kind="filtered" title={t('notes:noneFound')} onReset={() => { setSearch(''); setFilter({ q: '', label: '', color: '' }) }} />
        ) : (
          <EmptyState kind="new" title={t(`notes:empty.${filter.view}` as 'notes:empty.active')} />
        )
      ) : (
        <div className="space-y-6">
          {pinned.length > 0 ? (
            <section aria-labelledby="notes-pinned">
              <h2 id="notes-pinned" className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('notes:sections.pinned')}
              </h2>
              <NoteGrid notes={pinned} {...gridProps} />
            </section>
          ) : null}
          <section aria-labelledby={pinned.length > 0 ? 'notes-others' : undefined}>
            {pinned.length > 0 ? (
              <h2 id="notes-others" className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t('notes:sections.others')}
              </h2>
            ) : null}
            <NoteGrid notes={others} {...gridProps} />
          </section>
        </div>
      )}

      {selection.count > 0 && !desktop ? (
        <SelectionBar count={selection.count} allSelected={selection.allSelected} onSelectAll={selection.selectAll} onClear={selection.clear}>
          {selectionActions}
        </SelectionBar>
      ) : null}

      {filter.view === 'active' && selection.count === 0 ? (
        <Fab
          icon={<Plus className="h-6 w-6" />}
          label={t('notes:newNote')}
          actions={[
            { key: 'note', icon: <FilePlus className="h-4 w-4" />, label: t('notes:fab.note'), onClick: () => openNote(NEW_NOTE) },
            { key: 'list', icon: <CheckSquare className="h-4 w-4" />, label: t('notes:fab.list'), onClick: () => openNote(NEW_LIST) },
          ]}
        />
      ) : null}

      <NoteDialog
        target={openTarget}
        labels={labels}
        canShare={canShare}
        onClose={closeNote}
        actions={{
          share: (note) => {
            // Closed first, so the share dialog is not a second modal on top of this one.
            closeNote()
            share({ type: 'note', id: note.id, title: note.title })
          },
          openVersions: (note) => {
            openedByPush.current = false
            setParam({ note: null, versions: note.id }, true)
          },
          copyLink,
        }}
      />
      <VersionsPeek
        noteId={peekNoteId}
        onClose={() => setParam({ versions: null }, true)}
        onRestored={(note) => {
          openedByPush.current = false
          setParam({ versions: null, note: note.id }, true)
        }}
      />
      <LabelManager open={managingLabels} onOpenChange={setManagingLabels} labels={labels} />
      {shareDialog}
    </div>
  )
}
