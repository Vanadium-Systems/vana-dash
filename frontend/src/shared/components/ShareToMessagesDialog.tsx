import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Hash, Users } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog'
import { Input } from '@/shared/components/ui/input'
import { Textarea } from '@/shared/components/ui/textarea'
import { useDebounced } from '@/shared/hooks/use-debounced'
import { useMe } from '@/shared/hooks/use-me'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import type { RefType } from '@/shared/lib/types'
import { cn } from '@/shared/lib/utils'

// "Send to Messages" from any shareable object (MS1): pick a conversation (recent first) or a
// colleague, add a comment if you like, send. A colleague without a DM gets one first, through the
// same route as "New conversation", which returns the existing DM if there is one.

export interface ShareRef {
  type: RefType
  id: string
  title: string
  /** Email only: the selected passage (MS7). */
  quote?: string
}

type Target =
  | { kind: 'conversation'; id: string; title: string; memberIds: string[] }
  | { kind: 'user'; userId: string; displayName: string }

export function ShareToMessagesDialog({ shared, onClose }: { shared: ShareRef | null; onClose: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [term, setTerm] = useState('')
  const [comment, setComment] = useState('')
  const [picked, setPicked] = useState<Target | null>(null)
  const [sending, setSending] = useState(false)
  const debounced = useDebounced(term.trim(), 200)

  const targets = useQuery({
    queryKey: ['chat', 'recent-targets', debounced],
    queryFn: () => api.get<Target[]>(`/api/chat/conversations/recent-targets${debounced ? `?q=${encodeURIComponent(debounced)}` : ''}`),
    enabled: shared !== null,
    staleTime: 15_000,
  })

  const close = () => {
    setTerm('')
    setComment('')
    setPicked(null)
    onClose()
  }

  const send = async () => {
    if (!shared || !picked) return
    setSending(true)
    try {
      const conversationId =
        picked.kind === 'conversation'
          ? picked.id
          : (await api.post<{ id: string }>('/api/chat/conversations', { kind: 'dm', userId: picked.userId })).id
      await api.post(`/api/chat/conversations/${conversationId}/messages`, {
        body: comment.trim(),
        clientId: crypto.randomUUID(),
        refs: [{ type: shared.type, id: shared.id, quote: shared.quote }],
      })
      void queryClient.invalidateQueries({ queryKey: ['chat'] })
      const title = picked.kind === 'conversation' ? picked.title : picked.displayName
      close()
      toast.success(t('messages:share.sent', { title }), {
        action: { label: t('messages:share.open'), onClick: () => navigate(`/messages/${conversationId}`) },
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }

  const list = targets.data ?? []
  const conversations = list.filter((target): target is Extract<Target, { kind: 'conversation' }> => target.kind === 'conversation')
  const colleagues = list.filter((target): target is Extract<Target, { kind: 'user' }> => target.kind === 'user')
  const isPicked = (target: Target) =>
    picked !== null &&
    (target.kind === 'conversation' ? picked.kind === 'conversation' && picked.id === target.id : picked.kind === 'user' && picked.userId === target.userId)

  return (
    <Dialog open={shared !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent data-density="comfortable">
        <DialogHeader>
          <DialogTitle>{t('messages:share.title')}</DialogTitle>
        </DialogHeader>
        {shared ? (
          <p className="flex min-w-0 items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-sm">
            <Hash className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="shrink-0 text-muted-foreground">{t(`messages:refs.types.${shared.type}`)}</span>
            <span className="min-w-0 truncate font-medium">{shared.title}</span>
          </p>
        ) : null}
        <Input autoFocus value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('messages:share.search')} aria-label={t('messages:share.search')} />
        <div className="max-h-64 overflow-y-auto" role="listbox" aria-label={t('messages:share.search')}>
          {targets.isPending ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t('common:states.loading')}</p>
          ) : list.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t('messages:share.none')}</p>
          ) : (
            <>
              {conversations.length > 0 ? <GroupTitle>{t('messages:share.recent')}</GroupTitle> : null}
              {conversations.map((target) => (
                <TargetRow key={target.id} label={target.title} group={target.memberIds.length > 2} selected={isPicked(target)} onClick={() => setPicked(target)} />
              ))}
              {colleagues.length > 0 ? <GroupTitle>{t('messages:share.colleagues')}</GroupTitle> : null}
              {colleagues.map((target) => (
                <TargetRow key={target.userId} label={target.displayName} selected={isPicked(target)} onClick={() => setPicked(target)} />
              ))}
            </>
          )}
        </div>
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder={t('messages:share.comment')} aria-label={t('messages:share.comment')} />
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={() => void send()} disabled={!picked || sending}>
            {t('messages:share.send')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GroupTitle({ children }: { children: string }) {
  return <div className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">{children}</div>
}

function TargetRow({ label, group, selected, onClick }: { label: string; group?: boolean; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        'flex w-full min-w-0 items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'bg-accent font-medium',
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground" aria-hidden="true">
        {group ? <Users className="h-4 w-4" /> : label.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

/**
 * State + dialog for a page with share buttons: `share(ref)` opens it. `canShare` hides the
 * buttons for someone without Mesaje.
 */
export function useShareToMessages() {
  const { can } = useMe()
  const [shared, setShared] = useState<ShareRef | null>(null)
  const share = useCallback((ref: ShareRef) => setShared(ref), [])
  const dialog = <ShareToMessagesDialog shared={shared} onClose={() => setShared(null)} />
  return { canShare: can('mesaje.view'), share, dialog }
}
