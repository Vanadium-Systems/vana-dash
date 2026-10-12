import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Bell, BellOff, FileText, MoreHorizontal, Pencil, Play, RotateCw, Trash2, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Textarea } from '@/shared/components/ui/textarea'
import { api } from '@/shared/lib/api'
import { cn, formatBytes } from '@/shared/lib/utils'
import { formatDateTime, intlTag } from '@/shared/lib/format'
import type { ChatAttachment, ChatConversation } from '@/shared/lib/types'
import { useChatStream } from '@/shared/components/chat/ChatStreamProvider'
import { Composer } from './Composer'
import { MediaViewer } from './MediaViewer'
import { conversationTitle, presenceLabel } from './ConversationList'
import { useThreadMessages } from './useThreadMessages'
import { t } from '@/shared/lib/i18n'

// Firul (fișa „Mesaje"): rânduri plate, stil Slack — autor + oră pe primul mesaj dintr-o serie
// (același autor, sub 5 minute), nu bule colorate. Fără animație la sosire: se întâmplă de
// zeci de ori pe zi. Scroll la ultimul mesaj doar dacă erai deja jos, altfel „Mesaje noi ↓".

const SERIES_WINDOW_MS = 5 * 60 * 1000
const LONG_PRESS_MS = 500
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/3gpp']

/** Rândul din fir: mesajul de pe server sau cel optimist, cu aceleași câmpuri de afișat. */
interface ThreadRow {
  id?: string
  clientId: string
  conversationId: string
  authorUserId: string
  authorName: string
  body: string
  attachments: ChatAttachment[]
  createdAt: string
  editedAt: string | null
  deletedAt: string | null
  pending: 'sending' | 'failed' | null
  error: string | null
}

export function ThreadView({ conversation, meId, onBack }: { conversation: ChatConversation; meId: string; onBack?: () => void }) {
  const thread = useThreadMessages(conversation.id)
  const queryClient = useQueryClient()
  const { status } = useChatStream()
  const bottomRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [missed, setMissed] = useState(0)
  const [viewing, setViewing] = useState<ChatAttachment | null>(null)

  const rows = useMemo<ThreadRow[]>(
    () => [
      ...thread.messages.map((message) => ({ ...message, pending: null, error: null })),
      ...thread.pending.map((message) => ({
        clientId: message.clientId,
        conversationId: conversation.id,
        authorUserId: meId,
        authorName: 'Tu',
        body: message.body,
        attachments: message.attachments,
        createdAt: message.createdAt,
        editedAt: null,
        deletedAt: null,
        pending: message.status,
        error: message.error,
      })),
    ],
    [conversation.id, meId, thread.messages, thread.pending],
  )

  // Marcăm citit cât timp firul e deschis: e singurul loc unde știe omul că a citit.
  const lastReadId = rows[rows.length - 1]?.id
  useEffect(() => {
    if (!lastReadId || conversation.unreadCount === 0) return
    void api.post(`/api/chat/conversations/${conversation.id}/read`, { messageId: lastReadId }).catch(() => undefined)
  }, [conversation.id, conversation.unreadCount, lastReadId])

  useEffect(() => {
    const el = bottomRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => setAtBottom(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: '80px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Poziția de scroll se ține într-un ref, nu în dependențe: coborâm la mesajele nou doar
  // dacă omul era deja jos, nu de fiecare dată când se mișcă IntersectionObserver-ul.
  const atBottomRef = useRef(atBottom)
  useEffect(() => {
    atBottomRef.current = atBottom
  }, [atBottom])

  useEffect(() => {
    if (atBottomRef.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' })
      setMissed(0)
    } else {
      setMissed((count) => count + 1)
    }
  }, [rows.length])

  const toggleMute = async () => {
    try {
      await api.patch(`/api/chat/conversations/${conversation.id}`, { muted: !conversation.muted })
      await queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  if (thread.isPending) {
    return (
      <div className="space-y-3 p-4" aria-busy="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-10 w-2/3" />
        ))}
      </div>
    )
  }

  if (thread.isError) {
    return (
      <div className="p-6">
        <p className="text-sm">
          {t('messages:thread.loadFailed')}{' '}
          {/* Aceeași excepție ca în lista de conversații: acțiune de text într-o propoziție. */}
          <button type="button" className="underline underline-offset-2" onClick={() => void thread.refetch()}>
            {t('common:actions.retry')}
          </button>
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {onBack ? (
          <Button variant="ghost" size="icon" aria-label={t('messages:thread.backToList')} className="md:hidden" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{conversationTitle(conversation, meId)}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {conversation.kind === 'dm'
              ? presenceLabel(conversation.members.find((m) => m.id !== meId)?.presence, conversation.members.find((m) => m.id !== meId)?.lastSeenAt ?? null)
              : t('messages:thread.members', { count: conversation.members.length, names: conversation.members.map((m) => m.displayName ?? m.email).join(', ') })}
          </span>
        </span>
        {conversation.kind === 'group' ? <Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
        <Button
          variant="ghost"
          size="icon"
          aria-label={conversation.muted ? t('messages:thread.unmute') : t('messages:thread.mute')}
          onClick={() => void toggleMute()}
        >
          {conversation.muted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        </Button>
      </div>

      {/* Streamul căzut nu lasă lista goală: mesajele trimise pleacă oricum prin POST, deci
          omul scrie și citește; doar mesajele celorlalți întârzie. */}
      {status === 'connecting' ? (
        <p className="border-b px-4 py-1 text-xs text-muted-foreground" role="status">
          {t('messages:thread.reconnecting')}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
        {thread.hasMore ? (
          <div className="mb-3 text-center">
            <Button variant="outline" size="sm" disabled={thread.isLoadingOlder} onClick={() => void thread.loadOlder()}>
              {thread.isLoadingOlder ? t('common:states.loading') : t('messages:thread.older')}
            </Button>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('messages:thread.empty')}</p>
        ) : (
          rows.map((row, index) => (
            <MessageRow
              key={row.id ?? `pending-${row.clientId}`}
              message={row}
              own={row.authorUserId === meId}
              startsSeries={index === 0 || !sameSeries(rows[index - 1], row)}
              onRetry={() => void thread.retry(row.clientId)}
              onDiscard={() => thread.discard(row.clientId)}
              onEdit={(body) => {
                if (!row.id) return
                void thread.edit(row.id, body).catch((err: Error) => toast.error(err.message))
              }}
              onOpenMedia={setViewing}
              onDelete={() => {
                if (!row.id) return
                void thread.remove(row.id).catch((err: Error) => toast.error(err.message))
              }}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {missed > 0 && !atBottom ? (
        <div className="px-4 pb-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
              setMissed(0)
            }}
          >
            {t('messages:thread.newBelow')}
          </Button>
        </div>
      ) : null}

      <Composer conversationId={conversation.id} onSend={(input) => void thread.send(input)} />
      {viewing ? <MediaViewer attachment={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  )
}

function sameSeries(previous: ThreadRow | undefined, current: ThreadRow): boolean {
  if (!previous || previous.authorUserId !== current.authorUserId) return false
  return new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime() < SERIES_WINDOW_MS
}

function MessageRow({
  message,
  own,
  startsSeries,
  onRetry,
  onDiscard,
  onEdit,
  onDelete,
  onOpenMedia,
}: {
  message: ThreadRow
  own: boolean
  startsSeries: boolean
  onRetry: () => void
  onDiscard: () => void
  onEdit: (body: string) => void
  onDelete: () => void
  onOpenMedia: (attachment: ChatAttachment) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  if (message.deletedAt) {
    return <p className={cn('px-1 py-1 text-xs italic text-muted-foreground', own && 'text-right')}>{t('messages:thread.deleted')}</p>
  }

  // Pe telefon nu există hover: apăsarea lungă pe mesaj deschide același meniu ca „⋯".
  const canAct = own && !message.pending && !editing
  function startLongPress() {
    longPressTimer.current = setTimeout(() => setMenuOpen(true), LONG_PRESS_MS)
  }
  function cancelLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current)
    longPressTimer.current = null
  }

  return (
    <div className={cn('group flex items-center gap-1 px-1', own ? 'justify-end' : 'justify-start', startsSeries ? 'pt-2' : 'pt-0.5')}>
      {canAct ? (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            className={cn(
              'shrink-0 rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100',
              menuOpen ? 'opacity-100' : 'opacity-0',
            )}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{t('messages:thread.messageActions')}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              onClick={() => {
                setDraft(message.body)
                setEditing(true)
              }}
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              {t('common:actions.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem destructive onClick={onDelete}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {t('common:actions.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <div
        className={cn('flex min-w-0 max-w-[80%] flex-col', own ? 'items-end' : 'items-start', canAct && '[@media(pointer:coarse)]:select-none')}
        onContextMenu={canAct ? (e) => e.preventDefault() : undefined}
        onTouchStart={canAct ? startLongPress : undefined}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
      >
          {startsSeries ? (
            <div className={cn('flex flex-wrap items-baseline gap-2', own && 'justify-end')}>
              <span className="text-sm font-medium">{own ? t('messages:thread.you') : message.authorName}</span>
              <time
                className="text-xs text-muted-foreground tnum"
                dateTime={message.createdAt}
                title={formatDateTime(message.createdAt)}
              >
                {time(message.createdAt)}
              </time>
            </div>
          ) : null}

          {editing ? (
            <form
              className="mt-1 w-80 max-w-full space-y-2"
              onSubmit={(e) => {
                e.preventDefault()
                onEdit(draft)
                setEditing(false)
              }}
            >
              <Textarea
                value={draft}
                autoFocus
                rows={2}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Escape') return
                  e.preventDefault()
                  setEditing(false)
                }}
                aria-label={t('messages:thread.editMessage')}
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm">
                  {t('common:actions.save')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  {t('common:actions.discard')}
                </Button>
              </div>
            </form>
          ) : (
            <>
              {message.body ? <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p> : null}
              {message.attachments.length > 0 ? (
                <ul className={cn('mt-1 flex flex-col gap-1', own ? 'items-end' : 'items-start')}>
                  {message.attachments.map((attachment) => (
                    <AttachmentRow key={attachment.id} attachment={attachment} onOpen={() => onOpenMedia(attachment)} />
                  ))}
                </ul>
              ) : null}
              {message.editedAt ? <span className="text-xs text-muted-foreground">{t('messages:thread.edited')}</span> : null}
              {message.pending ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {message.pending === 'sending' ? (
                    <span>{t('common:states.sending')}</span>
                  ) : (
                    <>
                      {/* Starea de trimitere e rândul mesajului, cu acțiuni de text lângă ea
                          (aceleași ca în lista), nu butoane cu carapacă. */}
                      <StatePill tone="warning">{t('messages:thread.notSent')}</StatePill>
                      <button type="button" className="flex items-center gap-1 underline underline-offset-2" onClick={onRetry}>
                        <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('common:actions.tryAgainShort')}
                      </button>
                      <button type="button" className="underline underline-offset-2" onClick={onDiscard}>
                        {t('common:actions.discard')}
                      </button>
                    </>
                  )}
                </div>
              ) : null}
            </>
          )}
      </div>
    </div>
  )
}

function AttachmentRow({ attachment, onOpen }: { attachment: ChatAttachment; onOpen: () => void }) {
  const href = `/api/chat/attachments/${attachment.id}`
  if (IMAGE_TYPES.includes(attachment.contentType)) {
    return (
      <li>
        <button type="button" onClick={onOpen} className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <img src={href} alt={attachment.filename} loading="lazy" className="max-h-72 max-w-[min(280px,100%)] rounded-md object-cover" />
        </button>
      </li>
    )
  }
  if (VIDEO_TYPES.includes(attachment.contentType)) {
    // `#t=0.1` + preload metadata: browserul arată primul cadru ca miniatură, fără să tragă tot videoul.
    return (
      <li>
        <button
          type="button"
          onClick={onOpen}
          className="relative block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t('messages:thread.play', { filename: attachment.filename })}
        >
          <video src={`${href}#t=0.1`} preload="metadata" muted playsInline className="max-h-72 max-w-[min(280px,100%)] rounded-md bg-black" />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white">
              <Play className="h-5 w-5" aria-hidden="true" />
            </span>
          </span>
        </button>
      </li>
    )
  }
  return (
    <li>
      <button
        type="button"
        onClick={() => void api.download(`${href}?download=1`, attachment.filename).catch((err: Error) => toast.error(err.message))}
        className="inline-flex items-center gap-2 text-left text-sm underline underline-offset-2"
      >
        <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {attachment.filename}
        <span className="text-xs text-muted-foreground tnum">{formatBytes(attachment.sizeBytes)}</span>
      </button>
    </li>
  )
}

function time(iso: string): string {
  return new Intl.DateTimeFormat(intlTag(), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Bucharest',
  }).format(new Date(iso))
}