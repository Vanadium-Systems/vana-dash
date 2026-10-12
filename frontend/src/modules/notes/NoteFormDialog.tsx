import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Textarea } from '@/shared/components/ui/textarea'
import { api } from '@/shared/lib/api'
import type { Note } from '@/shared/lib/types'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'

interface NoteFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = create. */
  note: Note | null
}

export function NoteFormDialog({ open, onOpenChange, note }: NoteFormDialogProps) {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  useEffect(() => {
    if (!open) return
    setTitle(note?.title ?? '')
    setBody(note?.body ?? '')
  }, [open, note])

  const save = useMutation({
    mutationFn: () =>
      note
        ? api.patch<Note>(`/api/notes/${note.id}`, { title, body })
        : api.post<Note>('/api/notes', { title, body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notes'] })
      toast.success(note ? 'Notiță actualizată' : 'Notiță creată')
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  const remove = useMutation({
    mutationFn: () => api.delete<void>(`/api/notes/${note?.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notes'] })
      toast.success('Notiță ștearsă')
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{note ? 'Editează notița' : 'Notiță nouă'}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="note-title">Titlu</Label>
            <Input id="note-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="note-body">Conținut</Label>
            <Textarea
              id="note-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              className="whitespace-pre-wrap"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1" disabled={save.isPending}>
              {save.isPending ? 'Se salvează…' : 'Salvează'}
            </Button>
            {note ? (
              <Button
                type="button"
                variant="outline"
                disabled={remove.isPending}
                onClick={() => {
                  void confirm({ title: `Șterge notița „${note.title}”`, confirmLabel: 'Șterge notița', destructive: true }).then((ok) => ok && remove.mutate())
                }}
              >
                Șterge
              </Button>
            ) : null}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
