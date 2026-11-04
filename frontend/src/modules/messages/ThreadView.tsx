import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Info, Search, Users } from 'lucide-react'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileViewer } from '@/shared/components/FileViewer'
import { useChatStream } from '@/shared/components/chat/ChatStreamProvider'
import { Button } from '@/shared/components/ui/button'
import { Skeleton } from '@/shared/components/ui/skeleton'
import { useChatTyping } from '@/shared/hooks/use-chat'
import { useHotkeys } from '@/shared/hooks/use-hotkeys'
import { useUrlState } from '@/shared/hooks/use-url-state'
import { api } from '@/shared/lib/api'
import { t } from '@/shared/lib/i18n'
import { motionLevel } from '@/shared/lib/motion'
import type { ChatAttachment, ChatConversation, ChatMessageRef, ChatReceipt, ChatReplyPreview } from '@/shared/lib/types'
import { useLocation, useNavigate } from 'react-router-dom'
import { Composer, type ComposerHandle } from './Composer'
import { ConversationPanel } from './ConversationPanel'
import { conversationTitle, presenceLabel } from './ConversationList'
import { DaySeparator, dayKey } from './DaySeparator'
import { JumpToBottom } from './JumpToBottom'
import { MessageBubble, type ReceiptState, type ThreadRow } from './MessageBubble'
import { NewMessagesLine } from './NewMessagesLine'
import { useThreadMessages } from './useThreadMessages'
import { useMinuteTick } from '@/shared/hooks/use-minute-tick'

// The thread: bubbles as in WhatsApp (yours on the right), the behaviour of Slack around them:
// keyboard, a menu with shortcuts, "typing…" on a reserved line, jumping to a date. A series
// (same author, under 5 minutes) sits close and only its first bubble gets the corner and, in a
// group, the author's name. No animation on arrival: it happens dozens of times a day.

const SERIES_WINDOW_MS = 5 * 60 * 1000
const HIGHLIGHT_MS = 1500
// What a deleted message waits for before the server delete runs, the length of the undo toast.
const UNDO_MS = 6000

export function ThreadView({ conversation, meId, onBack }: { conversation: ChatConversation; meId: string; onBack?: () => void }) {
  const thread = useThreadMessages(conversation.id)
  useMinuteTick()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { status } = useChatStream()
  const typingByConversation = useChatTyping()
  const [panel, setPanel] = useUrlState('panel')
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<ComposerHandle>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  // Pinned to the end until the person scrolls up. A ref: the observers read it without re-subscribing.
  const pinnedRef = useRef(true)
  const [farFromEnd, setFarFromEnd] = useState(false)
  const [missed, setMissed] = useState(0)
  const [viewing, setViewing] = useState<ChatAttachment | null>(null)
  const [replyTo, setReplyTo] = useState<ChatReplyPreview | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  const pendingDeletes = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const memberName = useCallback(
    (userId: string) => {
      if (userId === meId) return t('messages:thread.you')
      const member = conversation.members.find((m) => m.id === userId)
      return member ? (member.displayName ?? member.email) : '?'
    },
    [conversation.members, meId],
  )

  const rows = useMemo<ThreadRow[]>(
    () => [
      ...thread.messages.filter((m) => !hiddenIds.has(m.id)).map((message) => ({ ...message, pending: null, error: null })),
      // A pending row whose saved copy has arrived (POST answer or stream) is the same message.
      ...thread.pending
        .filter((message) => !thread.messages.some((m) => m.clientId === message.clientId))
        .map((message) => ({
        clientId: message.clientId,
        conversationId: conversation.id,
        authorUserId: meId,
        authorName: t('messages:thread.you'),
        body: message.body,
        attachments: message.attachments,
        replyTo: message.replyTo,
        reactions: [],
        refs: (message.input.refs ?? []).map((ref) => ({
          id: `${message.clientId}-${ref.type}-${ref.id}`,
          type: ref.type,
          refId: null,
          state: 'snapshot' as const,
          canOpen: false,
          card: { title: ref.title },
        })),
        createdAt: message.createdAt,
        editedAt: null,
        deletedAt: null,
        pending: message.status,
        error: message.error,
      })),
    ],
    [conversation.id, hiddenIds, meId, thread.messages, thread.pending],
  )

  // The "New" line: before the first message from someone else after the watermark of the opening.
  const newLine = useMemo(() => {
    if (thread.openedReadId === null) {
      const index = rows.findIndex((r) => r.id && r.authorUserId !== meId)
      return conversation.unreadCount > 0 && index >= 0 ? { index, count: rows.length - index } : null
    }
    const readAt = rows.findIndex((r) => r.id === thread.openedReadId)
    if (readAt < 0) return null
    const index = rows.findIndex((r, i) => i > readAt && r.id && r.authorUserId !== meId)
    return index >= 0 ? { index, count: rows.slice(index).filter((r) => r.authorUserId !== meId).length } : null
    // Fixed once the thread opens: the count must not grow as messages come in.
  }, [thread.openedReadId, thread.isPending])

  // Read while the thread is open; a detached window is not the end of the conversation.
  const lastLiveId = thread.detached ? undefined : rows.filter((r) => r.id).at(-1)?.id
  useEffect(() => {
    if (!lastLiveId || conversation.unreadCount === 0) return
    void api.post(`/api/chat/conversations/${conversation.id}/read`, { messageId: lastLiveId }).catch(() => undefined)
  }, [conversation.id, conversation.unreadCount, lastLiveId])

  const scrollToEnd = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  // On opening: to the "New" line when there is one, otherwise to the end.
  const opened = useRef(false)
  useLayoutEffect(() => {
    if (opened.current || thread.isPending) return
    opened.current = true
    const target = newLine ? rows[newLine.index]?.id : undefined
    const el = target ? rowRefs.current.get(target) : undefined
    if (el && scrollRef.current) {
      pinnedRef.current = false
      scrollRef.current.scrollTop = el.offsetTop - 48
    } else {
      scrollToEnd()
    }
  }, [newLine, rows, scrollToEnd, thread.isPending])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      pinnedRef.current = distance < 80
      // Any distance a reader would scroll back, not a whole screen: short threads need it too.
      setFarFromEnd(distance > 160)
      if (pinnedRef.current) setMissed(0)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    // Photos load after the text and the phone keyboard shrinks the pane: while pinned, both
    // keep the last message in view.
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current && !thread.detached) scrollToEnd()
    })
    observer.observe(el)
    if (contentRef.current) observer.observe(contentRef.current)
    return () => {
      el.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [scrollToEnd, thread.isPending, thread.detached])

  const lastAuthorId = rows.at(-1)?.authorUserId
  const rowCount = rows.length
  const previousCount = useRef(rowCount)
  useEffect(() => {
    const grew = rowCount > previousCount.current
    previousCount.current = rowCount
    if (!grew || thread.detached) return
    // Your own message always brings you down to it, even after scrolling up.
    if (pinnedRef.current || lastAuthorId === meId) {
      pinnedRef.current = true
      scrollToEnd()
      setMissed(0)
    } else {
      setMissed((count) => count + 1)
    }
  }, [rowCount, lastAuthorId, meId, scrollToEnd, thread.detached])

  const reveal = useCallback((messageId: string) => {
    // After the window renders: centre the message and light it up.
    requestAnimationFrame(() => {
      const el = rowRefs.current.get(messageId)
      if (!el) return
      pinnedRef.current = false
      el.scrollIntoView({ block: 'center', behavior: motionLevel() === 'full' ? 'smooth' : 'auto' })
      setHighlightId(messageId)
      setTimeout(() => setHighlightId((current) => (current === messageId ? null : current)), HIGHLIGHT_MS)
    })
  }, [])

  const jump = useCallback(
    async (target: { messageId: string } | { date: string }) => {
      try {
        const id = await thread.jumpTo(target)
        if (id) setTimeout(() => reveal(id), 0)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    },
    [reveal, thread],
  )

  const goToLatest = () => {
    if (thread.detached) thread.returnToLatest()
    pinnedRef.current = true
    setMissed(0)
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: motionLevel() === 'full' ? 'smooth' : 'auto' }),
    )
  }

  const loadOlder = async () => {
    const el = scrollRef.current
    const before = el ? el.scrollHeight - el.scrollTop : 0
    await thread.loadOlder()
    // Keep the message under the reader's eyes where it was.
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - before
    })
  }

  // Deleting hides the message at once and runs the delete when the undo window closes, or
  // when the page goes away, so the reactions and cards really go with it.
  const flushDelete = useCallback(
    (messageId: string, keepalive = false) => {
      const timer = pendingDeletes.current.get(messageId)
      if (!timer) return
      clearTimeout(timer)
      pendingDeletes.current.delete(messageId)
      if (keepalive) {
        void fetch(`/api/chat/messages/${messageId}`, { method: 'DELETE', keepalive: true, credentials: 'same-origin' })
        return
      }
      thread.remove(messageId).catch((err: Error) => {
        setHiddenIds((current) => new Set([...current].filter((id) => id !== messageId)))
        toast.error(err.message)
      })
    },
    [thread],
  )
  useEffect(() => {
    const deletes = pendingDeletes.current
    const flushAll = () => [...deletes.keys()].forEach((id) => flushDelete(id, true))
    window.addEventListener('pagehide', flushAll)
    return () => {
      window.removeEventListener('pagehide', flushAll)
      flushAll()
    }
  }, [flushDelete])

  const deleteMessage = (messageId: string) => {
    setHiddenIds((current) => new Set(current).add(messageId))
    setFocusedId(null)
    pendingDeletes.current.set(
      messageId,
      setTimeout(() => flushDelete(messageId), UNDO_MS),
    )
    toast.success(t('messages:actions.deleted'), {
      duration: UNDO_MS,
      action: {
        label: t('common:undo.action'),
        onClick: () => {
          const timer = pendingDeletes.current.get(messageId)
          if (timer) clearTimeout(timer)
          pendingDeletes.current.delete(messageId)
          setHiddenIds((current) => new Set([...current].filter((id) => id !== messageId)))
        },
      },
    })
  }

  const startReply = (row: ThreadRow) => {
    if (!row.id) return
    setReplyTo({
      id: row.id,
      authorName: row.authorName,
      body: row.body.slice(0, 200),
      hasAttachment: row.attachments.length > 0,
      deleted: false,
    })
    composerRef.current?.focus()
  }

  // A company page (Clienți, Facturi) is granted by role: the request goes to whoever manages
  // the team, in a DM. Anything personal is shared by its owner, so the request is a reply.
  const requestAccess = async (row: ThreadRow, refItem: ChatMessageRef) => {
    const grantor = refItem.grantors?.[0]
    if (!grantor) {
      startReply(row)
      composerRef.current?.prefill(t('messages:refs.requestAccessText', { title: refItem.card.title }))
      return
    }
    try {
      const { id } = await api.post<{ id: string }>('/api/chat/conversations', { kind: 'dm', userId: grantor.userId })
      const text = t('messages:refs.requestAccessAdminText', { title: refItem.card.title, type: t(`messages:refs.types.${refItem.type}`).toLocaleLowerCase() })
      if (id === conversation.id) composerRef.current?.prefill(text)
      else navigate(`/messages/${id}`, { state: { prefill: text } })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    }
  }

  // Arriving from "Ask for access" in another conversation: the request is already written.
  const location = useLocation()
  useEffect(() => {
    const prefill = (location.state as { prefill?: string } | null)?.prefill
    if (prefill && !thread.isPending) composerRef.current?.prefill(prefill)
    // Once per arrival; the state stays on the history entry.
  }, [location.key, thread.isPending])

  const copy = (row: ThreadRow) => {
    void navigator.clipboard?.writeText(row.body).then(
      () => toast.success(t('messages:actions.copied')),
      () => toast.error(t('messages:actions.copyFailed')),
    )
  }

  const react = (row: ThreadRow, emoji: string) => {
    if (!row.id) return
    thread.toggleReaction(row.id, emoji, meId).catch((err: Error) => toast.error(err.message))
  }

  // ── Keyboard (#31) ─────────────────────────────────────────────────────────
  const navigable = rows.filter((r) => r.id && !r.deletedAt)
  const focusedRow = navigable.find((r) => r.id === focusedId)
  const focusRow = useCallback((id: string | null) => {
    setFocusedId(id)
    if (id) requestAnimationFrame(() => rowRefs.current.get(id)?.focus({ preventScroll: false }))
  }, [])
  const step = (delta: number) => {
    const index = navigable.findIndex((r) => r.id === focusedId)
    const next = navigable[Math.min(navigable.length - 1, Math.max(0, index + delta))]
    if (next?.id) focusRow(next.id)
  }
  const leaveMessages = () => {
    setFocusedId(null)
    composerRef.current?.focus()
  }
  useHotkeys(
    [
      { keys: 'arrowup', label: t('messages:keys.previous'), onKey: (e) => (e.preventDefault(), step(-1)) },
      { keys: 'arrowdown', label: t('messages:keys.next'), onKey: (e) => (e.preventDefault(), step(1)) },
      { keys: 'r', label: t('messages:actions.reply'), onKey: (e) => (e.preventDefault(), focusedRow && startReply(focusedRow), setFocusedId(null)) },
      { keys: 'c', label: t('messages:actions.copy'), onKey: () => focusedRow && copy(focusedRow) },
      {
        keys: 'e',
        label: t('common:actions.edit'),
        onKey: (e) => {
          if (focusedRow?.id && focusedRow.authorUserId === meId && focusedRow.body) {
            e.preventDefault()
            setEditingId(focusedRow.id)
          }
        },
      },
      {
        keys: 'delete',
        label: t('common:actions.delete'),
        onKey: () => focusedRow?.id && focusedRow.authorUserId === meId && deleteMessage(focusedRow.id),
      },
    ],
    { enabled: focusedId !== null && editingId === null },
  )

  const typingIds = (typingByConversation.get(conversation.id) ?? []).filter((id) => id !== meId)
  const other = conversation.kind === 'dm' ? conversation.members.find((m) => m.id !== meId) : undefined

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
          <button type="button" className="underline underline-offset-2" onClick={() => void thread.refetch()}>
            {t('common:actions.retry')}
          </button>
        </p>
      </div>
    )
  }

  const title = conversationTitle(conversation, meId)
  const jumpCount = thread.detached ? thread.arrivedWhileDetached : missed

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        {onBack ? (
          <Button variant="ghost" size="icon" aria-label={t('messages:thread.backToList')} className="md:hidden" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        ) : null}
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setPanel('info')}>
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {other
              ? presenceLabel(other.presence, other.lastSeenAt)
              : t('messages:thread.members', { count: conversation.members.length, names: conversation.members.map((m) => m.displayName ?? m.email).join(', ') })}
          </span>
        </button>
        {conversation.kind === 'group' ? <Users className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
        <Button variant="ghost" size="icon" aria-label={t('messages:panel.search')} onClick={() => setPanel('search')}>
          <Search className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label={t('messages:panel.info')} onClick={() => setPanel('info')}>
          <Info className="h-4 w-4" />
        </Button>
      </div>

      {/* A dropped stream does not empty the thread: sending goes through POST anyway. */}
      {status === 'connecting' ? (
        <p className="border-b px-4 py-1 text-xs text-muted-foreground" role="status">
          {t('messages:thread.reconnecting')}
        </p>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          className="scroll-subtle h-full overflow-y-auto overscroll-contain px-3 pb-3"
          onClick={(e) => {
            // A click on a message (not on its buttons, links or a text selection) picks it for the keys.
            const target = e.target as HTMLElement
            if (target.closest('button, a, input, textarea, video') || document.getSelection()?.toString()) return
            const id = target.closest<HTMLElement>('[data-message-id]')?.dataset.messageId
            if (id && navigable.some((r) => r.id === id)) focusRow(id)
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusedId(null)
          }}
          onKeyDown={(e) => {
            // Handled here, before the page's Esc that leaves the conversation.
            if (e.key === 'Escape' && focusedId) {
              e.preventDefault()
              e.stopPropagation()
              leaveMessages()
            }
          }}
        >
          <div ref={contentRef}>
            {thread.hasMore ? (
              <div className="my-3 text-center">
                <Button variant="outline" size="sm" disabled={thread.isLoadingOlder} onClick={() => void loadOlder()}>
                  {thread.isLoadingOlder ? t('common:states.loading') : t('messages:thread.older')}
                </Button>
              </div>
            ) : null}

            {rows.length === 0 ? (
              <EmptyThread title={title} />
            ) : (
              rows.map((row, index) => {
                const previous = rows[index - 1]
                const newDay = !previous || dayKey(previous.createdAt) !== dayKey(row.createdAt)
                // clientId, not id: the optimistic bubble and the saved one are the same element,
                // so sending does not remount it (that read as a flicker).
                const key = row.clientId
                return (
                  <Fragment key={key}>
                    {newDay ? <DaySeparator iso={row.createdAt} onJump={(date) => void jump({ date })} /> : null}
                    {newLine?.index === index ? <NewMessagesLine count={newLine.count} /> : null}
                    <MessageBubble
                      ref={(el) => {
                        if (row.id && el) rowRefs.current.set(row.id, el)
                        else if (row.id) rowRefs.current.delete(row.id)
                      }}
                      message={row}
                      own={row.authorUserId === meId}
                      meId={meId}
                      startsSeries={newDay || !sameSeries(previous, row)}
                      showAuthor={conversation.kind === 'group'}
                      receipt={row.authorUserId === meId && !row.pending ? receiptState(row.createdAt, thread.receipts) : null}
                      editing={editingId !== null && editingId === row.id}
                      focused={focusedId !== null && focusedId === row.id}
                      highlighted={highlightId !== null && highlightId === row.id}
                      nameOf={memberName}
                      actions={{
                        onReply: () => startReply(row),
                        onReact: (emoji) => react(row, emoji),
                        onCopy: () => copy(row),
                        onEditStart: () => row.id && setEditingId(row.id),
                        onEditSave: (body) => {
                          setEditingId(null)
                          if (row.id) thread.edit(row.id, body).catch((err: Error) => toast.error(err.message))
                        },
                        onEditCancel: () => setEditingId(null),
                        onDelete: () => row.id && deleteMessage(row.id),
                        onRetry: () => void thread.retry(row.clientId),
                        onDiscard: () => thread.discard(row.clientId),
                        onOpenMedia: setViewing,
                        onJumpToQuote: (messageId) => void jump({ messageId }),
                        onRequestAccess: (refItem) => void requestAccess(row, refItem),
                      }}
                    />
                  </Fragment>
                )
              })
            )}

            {thread.hasNewer ? (
              <div className="my-3 text-center">
                <Button variant="outline" size="sm" disabled={thread.isLoadingNewer} onClick={() => void thread.loadNewer()}>
                  {thread.isLoadingNewer ? t('common:states.loading') : t('messages:thread.newer')}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
        {farFromEnd || thread.detached ? <JumpToBottom count={jumpCount} onClick={goToLatest} /> : null}
      </div>

      {/* Reserved line: "typing…" never moves the thread or the composer (#28). */}
      <p className="h-5 truncate px-4 text-xs leading-5 text-muted-foreground" aria-live="polite">
        {typingIds.length > 0 ? t('messages:typing.named', { names: typingIds.map(memberName).join(', '), count: typingIds.length }) : ''}
      </p>

      <Composer
        ref={composerRef}
        conversationId={conversation.id}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
        onArrowUpEmpty={() => {
          const last = navigable.at(-1)
          if (last?.id) focusRow(last.id)
        }}
        onSend={(input) => {
          setReplyTo(null)
          void thread.send({ ...input, replyTo })
        }}
      />

      {viewing ? (
        <FileViewer
          files={[{ id: viewing.id, name: viewing.filename, url: `/api/chat/attachments/${viewing.id}`, mimeType: viewing.contentType }]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => setViewing(null)}
          onDownload={(file) => void api.download(`${file.url}?download=1`, file.name).catch((err: Error) => toast.error(err.message))}
        />
      ) : null}

      <ConversationPanel
        conversation={conversation}
        meId={meId}
        panel={panel === 'info' || panel === 'search' ? panel : null}
        onPanelChange={(next) => setPanel(next ?? '')}
        onJump={(messageId) => void jump({ messageId })}
        onOpenMedia={setViewing}
        onMutedChange={() => void queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] })}
      />
    </div>
  )
}

function EmptyThread({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-xl font-medium text-muted-foreground" aria-hidden="true">
        {title.slice(0, 1).toUpperCase()}
      </span>
      <p className="text-base font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{t('messages:thread.empty')}</p>
    </div>
  )
}

/** WhatsApp's rule: in a group, the second tick and the blue only once every member got there. */
function receiptState(createdAt: string, receipts: ChatReceipt[]): ReceiptState {
  if (receipts.length === 0) return 'sent'
  const sentAt = Date.parse(createdAt)
  const reached = (iso: string | null) => iso !== null && Date.parse(iso) >= sentAt
  if (receipts.every((r) => reached(r.readUpTo))) return 'seen'
  if (receipts.every((r) => reached(r.readUpTo) || reached(r.deliveredUpTo))) return 'delivered'
  return 'sent'
}

function sameSeries(previous: ThreadRow | undefined, current: ThreadRow): boolean {
  if (!previous || previous.authorUserId !== current.authorUserId) return false
  return new Date(current.createdAt).getTime() - new Date(previous.createdAt).getTime() < SERIES_WINDOW_MS
}
