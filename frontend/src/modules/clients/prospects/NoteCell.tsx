import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { DropdownMenu, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { ResponsiveMenuContent } from '@/shared/components/ui/responsive-menu'
import { Textarea } from '@/shared/components/ui/textarea'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { ProspectRow } from './types'

// A big editor in a popover (a bottom sheet on a phone) instead of a cramped textarea in the row.
// Saves when it closes; Esc and a click outside both close it. The sheet keeps the full note history.
export function NoteCell({ row }: { row: Pick<ProspectRow, 'id' | 'name' | 'note' | 'canEdit'> }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const opened = useRef('')
  const body = row.note?.body ?? ''

  const save = useMutation({
    mutationFn: (text: string) =>
      row.note ? api.patch(`/api/prospects/${row.id}/notes/${row.note.id}`, { body: text }) : api.post(`/api/prospects/${row.id}/notes`, { body: text }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['prospects'] }),
    onError: (err) => toast.error(err.message),
  })

  const onOpenChange = (next: boolean) => {
    if (next) {
      opened.current = body
      setDraft(body)
    } else {
      // An emptied note is not saved: the backend refuses an empty body, and deleting is the sheet's job.
      const text = draft.trim()
      if (row.canEdit && text && text !== opened.current.trim()) save.mutate(text)
    }
    setOpen(next)
  }

  if (!row.note && !row.canEdit) return <span className="text-muted-foreground">—</span>
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger className="block w-full min-w-0 max-w-[16rem] rounded-sm text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {row.note ? <span className="line-clamp-2 whitespace-pre-line break-words">{body}</span> : <span className="text-muted-foreground">{t('clients:prospects.note.add')}</span>}
        <span className="sr-only"> {t('clients:prospects.note.open', { name: row.name })}</span>
      </DropdownMenuTrigger>
      <ResponsiveMenuContent title={row.name} align="start">
        <div className="w-[min(32rem,calc(100vw-2rem))] max-w-full p-1">
          <Textarea
            autoFocus
            rows={8}
            value={draft}
            readOnly={!row.canEdit}
            aria-label={t('clients:prospects.note.label', { name: row.name })}
            placeholder={t('clients:prospects.note.placeholder')}
            onChange={(e) => setDraft(e.target.value)}
            // The menu panel moves focus with the arrow keys and Home / End; in an editor they move the caret.
            onKeyDown={(e) => {
              if (e.key !== 'Escape') e.stopPropagation()
            }}
          />
        </div>
      </ResponsiveMenuContent>
    </DropdownMenu>
  )
}
