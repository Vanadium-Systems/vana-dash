import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { SidePeek } from '@/shared/components/ui/side-peek'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { api } from '@/shared/lib/api'
import { formatDateTime } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'
import type { Note, NoteVersion, NoteVersionSummary } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'
import { useState } from 'react'
import { NotePreview } from './NotePreview'

// Version history (N17): the list on the side, a read-only preview of the one picked, and the
// restore. The current text becomes a version itself before the old one is put back (the server does that).
export function VersionsPeek({ noteId, onClose, onRestored }: { noteId: string | null; onClose: () => void; onRestored: (note: Note) => void }) {
  const queryClient = useQueryClient()
  const [pickedId, setPickedId] = useState<string | null>(null)

  const list = useQuery({
    queryKey: ['notes', 'versions', noteId],
    queryFn: () => api.get<NoteVersionSummary[]>(`/api/notes/${noteId}/versions`),
    enabled: noteId !== null,
  })
  const picked = useQuery({
    queryKey: ['notes', 'versions', noteId, pickedId],
    queryFn: () => api.get<NoteVersion>(`/api/notes/${noteId}/versions/${pickedId}`),
    enabled: noteId !== null && pickedId !== null,
  })
  const restore = useMutation({
    mutationFn: () => api.post<Note>(`/api/notes/${noteId}/versions/${pickedId}/restore`, {}),
    onSuccess: (note) => {
      void queryClient.invalidateQueries({ queryKey: ['notes'] })
      toast.success(t('notes:versions.restored'))
      setPickedId(null)
      onRestored(note)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <SidePeek
      open={noteId !== null}
      onClose={() => {
        setPickedId(null)
        onClose()
      }}
      title={t('notes:versions.title')}
    >
      {list.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : !list.data?.length ? (
        <p className="text-sm text-muted-foreground">{t('notes:versions.none')}</p>
      ) : (
        <div className="space-y-4">
          <ul className="space-y-1">
            {list.data.map((version) => (
              <li key={version.id}>
                <button
                  type="button"
                  aria-pressed={version.id === pickedId}
                  onClick={() => setPickedId(version.id)}
                  className={cn('w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', version.id === pickedId && 'bg-accent')}
                >
                  <span className="block font-medium">{formatDateTime(version.createdAt)}</span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{version.title || version.excerpt}</span>
                </button>
              </li>
            ))}
          </ul>
          {pickedId ? (
            <div className="space-y-3 border-t pt-4">
              {picked.isPending ? (
                <Skeleton className="h-24 w-full" />
              ) : picked.data ? (
                <>
                  {picked.data.title ? <h3 className="text-sm font-semibold">{picked.data.title}</h3> : null}
                  <NotePreview note={picked.data} />
                  <Button onClick={() => restore.mutate()} disabled={restore.isPending}>
                    {t('notes:versions.restore')}
                  </Button>
                </>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t('notes:versions.hint')}</p>
          )}
        </div>
      )}
    </SidePeek>
  )
}
