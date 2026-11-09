import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { Note } from '@/shared/lib/types'
import { undoToast } from '@/shared/lib/undo-toast'

export type NotesView = 'active' | 'archived' | 'trash'

export interface NotesFilter {
  view: NotesView
  q: string
  label: string
  color: string
}

export interface LabelCount {
  name: string
  count: number
}

type BulkAction = 'archive' | 'unarchive' | 'delete' | 'restore' | 'pin' | 'unpin' | 'color' | 'addLabel' | 'removeLabel'

export const notesListKey = (filter: NotesFilter) => ['notes', 'list', filter.view, filter.q, filter.label, filter.color] as const
export const noteDetailKey = (id: string) => ['notes', 'detail', id] as const
export const NOTE_LABELS_KEY = ['notes', 'labels'] as const

export function fetchNotes(filter: NotesFilter): Promise<Note[]> {
  const params = new URLSearchParams({ view: filter.view })
  if (filter.q) params.set('q', filter.q)
  if (filter.label) params.set('label', filter.label)
  if (filter.color) params.set('color', filter.color)
  return api.get<Note[]>(`/api/notes?${params}`)
}

const bulk = (ids: string[], action: BulkAction, value?: number | string | null) =>
  api.post<{ updated: number }>('/api/notes/bulk', { ids, action, ...(value === undefined ? {} : { value }) })

/**
 * Every action on one or more notes ends in a toast that says what happened and undoes it (N14).
 * A single note goes through the same bulk route, so the undo is the same code too.
 */
export function useNoteActions() {
  const queryClient = useQueryClient()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notes'] })

  const run = async (message: string, effect: () => Promise<unknown>, undo: () => Promise<unknown>) => {
    const ok = await undoToast(message, effect, undo)
    await refresh()
    return ok
  }
  const ids = (notes: Note[]) => notes.map((note) => note.id)

  return {
    archive: (notes: Note[]) =>
      run(t('notes:toast.archived', { count: notes.length }), () => bulk(ids(notes), 'archive'), () => bulk(ids(notes), 'unarchive').then(refresh)),
    unarchive: (notes: Note[]) =>
      run(t('notes:toast.unarchived', { count: notes.length }), () => bulk(ids(notes), 'unarchive'), () => bulk(ids(notes), 'archive').then(refresh)),
    trash: (notes: Note[]) =>
      run(t('notes:toast.trashed', { count: notes.length }), () => bulk(ids(notes), 'delete'), () => bulk(ids(notes), 'restore').then(refresh)),
    restore: (notes: Note[]) =>
      run(t('notes:toast.restored', { count: notes.length }), () => bulk(ids(notes), 'restore'), () => bulk(ids(notes), 'delete').then(refresh)),
    pin: (notes: Note[], pinned: boolean) =>
      run(
        t(pinned ? 'notes:toast.pinned' : 'notes:toast.unpinned', { count: notes.length }),
        () => bulk(ids(notes), pinned ? 'pin' : 'unpin'),
        () => bulk(ids(notes), pinned ? 'unpin' : 'pin').then(refresh),
      ),
    setColor: (notes: Note[], color: number | null) => {
      // The previous colors differ per note, so the undo puts each group back with its own call.
      const previous = new Map<number | null, string[]>()
      for (const note of notes) previous.set(note.color, [...(previous.get(note.color) ?? []), note.id])
      return run(
        t('notes:toast.colored', { count: notes.length }),
        () => bulk(ids(notes), 'color', color),
        () => Promise.all([...previous].map(([was, group]) => bulk(group, 'color', was))).then(refresh),
      )
    },
    addLabel: (notes: Note[], label: string) => {
      const without = notes.filter((note) => !note.labels.includes(label))
      if (without.length === 0) return Promise.resolve(true)
      return run(t('notes:toast.labeled', { count: without.length, label }), () => bulk(ids(without), 'addLabel', label), () => bulk(ids(without), 'removeLabel', label).then(refresh))
    },
    removeLabel: (notes: Note[], label: string) => {
      const withLabel = notes.filter((note) => note.labels.includes(label))
      if (withLabel.length === 0) return Promise.resolve(true)
      return run(t('notes:toast.unlabeled', { count: withLabel.length, label }), () => bulk(ids(withLabel), 'removeLabel', label), () => bulk(ids(withLabel), 'addLabel', label).then(refresh))
    },
  }
}
