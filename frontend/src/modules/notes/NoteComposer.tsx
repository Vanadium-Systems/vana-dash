import { useQueryClient } from '@tanstack/react-query'
import { CheckSquare } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { Note, NoteDoc } from '@/shared/lib/types'
import { EMPTY_TASK_DOC, isEmptyNote, plainToDoc } from './note-doc'
import { NoteEditor } from './NoteEditor'

// The "Create a note…" bar above the grid (N5). It opens in place into title + body and saves when
// it loses focus; a note with nothing in it is simply not created.
export function NoteComposer() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState<null | 'note' | 'list'>(null)
  const [title, setTitle] = useState('')
  const docRef = useRef<NoteDoc>(plainToDoc(''))
  const rootRef = useRef<HTMLDivElement>(null)

  const finish = async () => {
    const draft = { title, doc: docRef.current }
    setOpen(null)
    setTitle('')
    docRef.current = plainToDoc('')
    if (isEmptyNote(draft.title, draft.doc)) return
    try {
      await api.post<Note>('/api/notes', { title: draft.title, bodyJson: draft.doc })
      void queryClient.invalidateQueries({ queryKey: ['notes'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('notes:saveFailed'))
    }
  }
  const finishRef = useRef(finish)
  finishRef.current = finish

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement
      // The editor's floating bar and the "/" menu live outside this box but belong to it.
      if (rootRef.current?.contains(target) || target.closest('.glass, [role="menu"], [role="listbox"]')) return
      void finishRef.current()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (document.querySelector('[data-note-slash]') || (e.target as HTMLElement).closest('[data-esc-local]')) return
      void finishRef.current()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="w-full max-w-xl rounded-lg border bg-card text-card-foreground shadow-sm">
      {open ? (
        <div className="space-y-2 p-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={255}
            placeholder={t('notes:titlePlaceholder')}
            aria-label={t('notes:titlePlaceholder')}
            className="w-full bg-transparent text-sm font-semibold outline-none placeholder:text-muted-foreground"
          />
          <NoteEditor key={open} doc={open === 'list' ? EMPTY_TASK_DOC : plainToDoc('')} autoFocus onChange={(doc) => (docRef.current = doc)} onSubmit={() => void finish()} className="min-h-12" />
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => void finish()}>
              {t('notes:done')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => setOpen('note')}
            className="h-control-lg min-w-0 flex-1 truncate rounded-l-lg px-4 text-left text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('notes:composer.placeholder')}
          </button>
          <Button variant="ghost" size="icon" title={t('notes:composer.list')} aria-label={t('notes:composer.list')} onClick={() => setOpen('list')} className="mr-1">
            <CheckSquare />
          </Button>
        </div>
      )}
    </div>
  )
}
