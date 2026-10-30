import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Bell, BellOff, Check, CheckCheck, Clock, FileText, MoreHorizontal, Pencil, Play, RotateCw, Trash2, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/shared/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/components/ui/dropdown-menu'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { StatePill } from '@/shared/components/ui/state-pill'
import { Textarea } from '@/shared/components/ui/textarea'
import { api } from '@/shared/lib/api'
import { cn, formatBytes } from '@/shared/lib/utils'
import { companyTimeZone, formatDateTime, intlTag } from '@/shared/lib/format'
import type { ChatAttachment, ChatConversation, ChatReceipt } from '@/shared/lib/types'
import { useChatStream } from '@/shared/components/chat/ChatStreamProvider'
import { Composer } from './Composer'
import { MediaViewer } from './MediaViewer'
import { conversationTitle, presenceLabel } from './ConversationList'
import { useThreadMessages } from './useThreadMessages'
import { t } from '@/shared/lib/i18n'

// The thread: one bubble per message, as in WhatsApp (Stefan, 2026-10-19), yours on the right
// with the time and the ticks inside. A series (same author, under 5 minutes) sits close and only
// its first bubble gets the corner and, in a group, the author's name. No animation on arrival:
// it happens dozens of times a day. The thread stays at the last message until you scroll up;
// then new ones are counted in "New messages ↓".

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
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // Pinned to the end until the person scrolls up. A ref, not state: the resize observer and
  // the effect on new rows read it without re-subscribing.
  const pinnedRef = useRef(true)
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

  const scrollToEnd = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => {
    pinnedRef.current = true
    setAtBottom(true)
    setMissed(0)
  }, [conversation.id])

  // The pane exists only once the thread has loaded, hence `thread.isPending` below.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      pinnedRef.current = near
      setAtBottom(near)
      if (near) setMissed(0)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    // Photos finish loading after the text, and the phone keyboard shrinks the pane: while
    // pinned, both keep the last message in view.
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) scrollToEnd()
    })
    observer.observe(el)
    if (contentRef.current) observer.observe(contentRef.current)
    return () => {
      el.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [scrollToEnd, thread.isPending])

  const lastAuthorId = rows[rows.length - 1]?.authorUserId
  useEffect(() => {
    // Your own message always brings you down to it, even after scrolling up.
    if (pinnedRef.current || lastAuthorId === meId) {
      pinnedRef.current = true
      scrollToEnd()
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

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
        <div ref={contentRef}>
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
              showAuthor={conversation.kind === 'group'}
              receipt={row.authorUserId === meId && !row.pending ? receiptState(row.createdAt, thread.receipts) : null}
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
        </div>
      </div>

      {missed > 0 && !atBottom ? (
        <div className="px-4 pb-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              pinnedRef.current = true
              scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
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

type ReceiptState = 'sent' | 'delivered' | 'seen'

/** WhatsApp's rule: in a group, the second tick and the blue only once every member got there. */
function receiptState(createdAt: string, receipts: ChatReceipt[]): ReceiptState {
  if (receipts.length === 0) return 'sent'
  const sentAt = Date.parse(createdAt)
  const reached = (iso: string | null) => iso !== null && Date.parse(iso) >= sentAt
  if (receipts.every((r) => reached(r.readUpTo))) return 'seen'
  if (receipts.every((r) => reached(r.readUpTo) || reached(r.deliveredUpTo))) return 'delivered'
  return 'sent'
}

function Ticks({ state }: { state: ReceiptState }) {
  const label = t(`messages:thread.receipt.${state}`)
  const Icon = state === 'sent' ? Check : CheckCheck
  return (
    <span title={label} className={cn('inline-flex', state === 'seen' ? 'text-tick-seen' : 'text-muted-foreground')}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
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
  showAuthor,
  receipt,
  onRetry,
  onDiscard,
  onEdit,
  onDelete,
  onOpenMedia,
}: {
  message: ThreadRow
  own: boolean
  startsSeries: boolean
  showAuthor: boolean
  receipt: ReceiptState | null
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
          {startsSeries && showAuthor && !own ? <span className="mb-0.5 px-1 text-xs font-medium text-muted-foreground">{message.authorName}</span> : null}

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
              <div
                className={cn(
                  'min-w-0 max-w-full rounded-lg px-2.5 py-1.5',
                  own ? 'bg-bubble-own' : 'bg-bubble-other',
                  startsSeries && (own ? 'rounded-tr-sm' : 'rounded-tl-sm'),
                )}
              >
                {message.attachments.length > 0 ? (
                  <ul className={cn('flex flex-col gap-1', message.body && 'mb-1')}>
                    {message.attachments.map((attachment) => (
                      <AttachmentRow key={attachment.id} attachment={attachment} onOpen={() => onOpenMedia(attachment)} />
                    ))}
                  </ul>
                ) : null}
                {message.body ? <p className="whitespace-pre-wrap break-words text-sm">{message.body}</p> : null}
                <div className="mt-0.5 flex items-center justify-end gap-1 text-xs text-muted-foreground">
                  {message.editedAt ? <span>{t('messages:thread.edited')}</span> : null}
                  <time className="tnum" dateTime={message.createdAt} title={formatDateTime(message.createdAt)}>
                    {time(message.createdAt)}
                  </time>
                  {message.pending === 'sending' ? (
                    <span title={t('common:states.sending')} className="inline-flex">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="sr-only">{t('common:states.sending')}</span>
                    </span>
                  ) : null}
                  {receipt ? <Ticks state={receipt} /> : null}
                </div>
              </div>
              {message.pending === 'failed' ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
          {/* The thumbnail (640px), not the original: a phone photo is megabytes, shown here at 280px. */}
          <img src={`${href}?size=thumb`} alt={attachment.filename} loading="lazy" className="max-h-72 max-w-[min(280px,100%)] rounded-md object-cover" />
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
    timeZone: companyTimeZone(),
  }).format(new Date(iso))
}