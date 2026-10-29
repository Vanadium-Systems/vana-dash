import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pin, PinOff, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/shared/components/PageHeader'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { api } from '@/shared/lib/api'
import type { Note } from '@/shared/lib/types'
import { NoteFormDialog } from './NoteFormDialog'
import { useConsumeParam } from '@/shared/hooks/use-consume-param'
import { intlTag } from '@/shared/lib/format'
import { t } from '@/shared/lib/i18n'

export function NotesPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingNote, setEditingNote] = useState<Note | null>(null)

  const notes = useQuery({
    queryKey: ['notes', search],
    queryFn: () => api.get<Note[]>(`/api/notes${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  })

  const togglePin = useMutation({
    mutationFn: (note: Note) => api.patch<Note>(`/api/notes/${note.id}`, { pinned: !note.pinned }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notes'] }),
    onError: (err) => toast.error(err.message),
  })

  const openCreate = () => {
    setEditingNote(null)
    setDialogOpen(true)
  }
  useConsumeParam('new', () => openCreate())

  const openEdit = (note: Note) => {
    setEditingNote(note)
    setDialogOpen(true)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('common:nav.notes')}
        actions={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> {t('common:palette.newNote')}
          </Button>
        }
      />

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t('notes:searchPlaceholder')}
          className="pl-8"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {notes.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : !notes.data?.length ? (
        <p className="text-sm text-muted-foreground">
          {search ? t('notes:noneFound') : t('notes:empty')}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {notes.data.map((note) => (
            <Card
              key={note.id}
              interactive
              className="animate-in cursor-pointer fade-in-0 duration-200 ease-out"
              onClick={() => openEdit(note)}
            >
              <CardContent className="space-y-2 pt-6">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-medium leading-snug">{note.title}</h3>
                  <Button
                    variant="ghost"
                    className="shrink-0"
                    title={note.pinned ? t('notes:unpin') : t('notes:pin')}
                    onClick={(e) => {
                      e.stopPropagation()
                      togglePin.mutate(note)
                    }}
                  >
                    {note.pinned ? <Pin className="h-4 w-4 fill-current text-primary" /> : <PinOff className="h-4 w-4 text-muted-foreground" />}
                  </Button>
                </div>
                <p className="line-clamp-4 whitespace-pre-wrap text-sm text-muted-foreground">{note.body}</p>
                <p className="text-xs text-muted-foreground">{new Date(note.updatedAt).toLocaleDateString(intlTag())}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <NoteFormDialog open={dialogOpen} onOpenChange={setDialogOpen} note={editingNote} />
    </div>
  )
}
