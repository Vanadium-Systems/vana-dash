import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { LabelCount } from './notes-api'

// "Manage labels": rename and delete across all of the person's notes (N18).
export function LabelManager({ open, onOpenChange, labels }: { open: boolean; onOpenChange: (open: boolean) => void; labels: LabelCount[] }) {
  const queryClient = useQueryClient()
  const confirm = useConfirm()
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notes'] })
  const rename = useMutation({
    mutationFn: ({ name, newName }: { name: string; newName: string }) => api.patch(`/api/notes/labels/${encodeURIComponent(name)}`, { newName }),
    onSuccess: (_data, { name }) => {
      setDrafts(({ [name]: _gone, ...rest }) => rest)
      void refresh()
    },
    onError: (err) => toast.error(err.message),
  })
  const remove = useMutation({
    mutationFn: (name: string) => api.delete(`/api/notes/labels/${encodeURIComponent(name)}`),
    onSuccess: () => void refresh(),
    onError: (err) => toast.error(err.message),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('notes:label.manage')}</DialogTitle>
          <DialogDescription>{t('notes:label.manageHint')}</DialogDescription>
        </DialogHeader>
        {labels.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('notes:label.none')}</p>
        ) : (
          <ul className="space-y-2">
            {labels.map((label) => {
              const draft = drafts[label.name] ?? label.name
              const commit = () => {
                const next = draft.trim()
                if (next && next !== label.name) rename.mutate({ name: label.name, newName: next })
                else setDrafts(({ [label.name]: _gone, ...rest }) => rest)
              }
              return (
                <li key={label.name} className="flex items-center gap-2">
                  <Input
                    value={draft}
                    maxLength={50}
                    aria-label={t('notes:label.rename', { label: label.name })}
                    onChange={(e) => setDrafts((current) => ({ ...current, [label.name]: e.target.value }))}
                    onBlur={commit}
                    onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                  />
                  <span className="tnum w-8 shrink-0 text-right text-xs text-muted-foreground">{label.count}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    title={t('notes:label.delete', { label: label.name })}
                    aria-label={t('notes:label.delete', { label: label.name })}
                    onClick={() =>
                      void confirm({
                        title: t('notes:label.deleteTitle', { label: label.name }),
                        consequence: t('notes:label.deleteConsequence', { count: label.count }),
                        confirmLabel: t('notes:label.deleteConfirm'),
                        destructive: true,
                      }).then((ok) => ok && remove.mutate(label.name))
                    }
                  >
                    <Trash2 />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
