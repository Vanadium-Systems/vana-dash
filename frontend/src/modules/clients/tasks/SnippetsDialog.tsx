import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { useConfirm } from '@/shared/components/ui/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Field } from '@/shared/components/ui/field'
import { Input } from '@/shared/components/ui/input'
import { Switch } from '@/shared/components/ui/switch'
import { Textarea } from '@/shared/components/ui/textarea'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { Snippet } from './types'
import { useSnippets } from './use-tasks-data'

interface Draft {
  id: string | null
  name: string
  body: string
  shared: boolean
}
const BLANK: Draft = { id: null, name: '', body: '', shared: false }

/** Saved texts for the `/` menu: mine to edit, colleagues' shared ones to read. */
export function SnippetsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { session } = useMe()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const snippets = useSnippets()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (value: Draft) => {
      const body = { name: value.name.trim(), body: value.body.trim(), shared: value.shared }
      return value.id ? api.patch(`/api/snippets/${value.id}`, body) : api.post('/api/snippets', body)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['snippets'] })
      setDraft(null)
    },
    onError: (err) => toast.error(err.message),
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/snippets/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['snippets'] }),
    onError: (err) => toast.error(err.message),
  })

  const submit = () => {
    if (!draft) return
    if (!draft.name.trim() || !draft.body.trim()) return setError(t('clients:tasks.snippets.required'))
    setError(null)
    save.mutate(draft)
  }
  const mine = (snippet: Snippet) => snippet.ownerUserId === session?.user.id

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setDraft(null)
        onOpenChange(next)
      }}
    >
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('clients:tasks.snippets.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('clients:tasks.snippets.hint')}</p>
        {draft ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <Field label={t('clients:tasks.snippets.name')} error={error}>
              <Input maxLength={100} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label={t('clients:tasks.snippets.body')}>
              <Textarea rows={5} maxLength={5000} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={draft.shared} onCheckedChange={(shared) => setDraft({ ...draft, shared })} label={t('clients:tasks.snippets.shared')} />
              {t('clients:tasks.snippets.shared')}
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                {t('common:actions.cancel')}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {t('common:actions.save')}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <ul className="space-y-2">
              {(snippets.data ?? []).map((snippet) => (
                <li key={snippet.id} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">/{snippet.name}</span>
                      {snippet.shared ? <Badge variant="secondary">{t('clients:lists.sharedBadge')}</Badge> : null}
                    </p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{snippet.body}</p>
                  </div>
                  {mine(snippet) ? (
                    <>
                      <Button type="button" size="icon-sm" variant="ghost" aria-label={t('common:actions.edit')} title={t('common:actions.edit')} onClick={() => setDraft({ id: snippet.id, name: snippet.name, body: snippet.body, shared: snippet.shared })}>
                        <Pencil />
                      </Button>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('common:actions.delete')}
                        title={t('common:actions.delete')}
                        onClick={() =>
                          void confirm({ title: t('clients:tasks.snippets.deleteTitle', { name: snippet.name }), confirmLabel: t('common:actions.delete'), destructive: true }).then((ok) => ok && remove.mutate(snippet.id))
                        }
                      >
                        <Trash2 />
                      </Button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
            {snippets.isSuccess && snippets.data.length === 0 ? <p className="text-sm text-muted-foreground">{t('clients:tasks.snippets.empty')}</p> : null}
            <Button type="button" variant="outline" onClick={() => setDraft(BLANK)}>
              {t('clients:tasks.snippets.new')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
